import {
  AgentNotFoundError,
  BotanicalError,
  ChatNotFoundError,
  ValidationError,
  createAgentSchema,
  createChatSchema,
  postMessageSchema,
  prepareTurn,
  rejectAgentRebind,
  runAgentTurn,
  sendAgentMessageSchema,
  updateAgentSchema,
  updateChatSchema,
  type AgentMessageStatus,
  type McpToolBridge,
  type RuntimeDeps,
  type Store,
} from "@botanical/agent-runtime";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ZodTypeAny } from "zod";
import { type output } from "zod";

export interface RuntimeAppDeps extends RuntimeDeps {
  persistence?: "memory" | "postgres";
  mcp?: McpToolBridge | null;
}

const STATUSES = new Set<AgentMessageStatus>(["pending", "delivered", "read", "failed"]);

export function createRuntimeApp(deps: RuntimeAppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof BotanicalError) return jsonError(c, error);
    console.error("[botanical] request failed", error);
    return c.json({ error: "Internal error", code: "INTERNAL" }, 500);
  });

  app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404));

  const health = (c: Context) =>
    c.json({
      ok: true,
      service: "botanical-runtime",
      persistence: deps.persistence ?? "memory",
    });

  app.get("/health", health);
  app.get("/api/runtime/health", health);

  app.get("/api/profiles", async (c) => {
    const profiles = await deps.profiles.list();
    return c.json({ defaultProfileId: null, profiles });
  });

  app.get("/api/agents", async (c) => {
    const agents = await deps.store.agents.list(parseLimit(c.req.query("limit"), 200, 500));
    return c.json({ agents });
  });

  app.post("/api/agents", async (c) => {
    const input = parseBody(createAgentSchema, await readJson(c));
    const agent = await deps.store.agents.create(input);
    return c.json({ agent }, 201);
  });

  app.get("/api/agents/:id", async (c) => {
    const agent = await requireAgent(deps.store, c.req.param("id"));
    return c.json({ agent });
  });

  app.patch("/api/agents/:id", async (c) => {
    const input = parseBody(updateAgentSchema, await readJson(c));
    const agent = await deps.store.agents.update(c.req.param("id"), input);
    return c.json({ agent });
  });

  app.delete("/api/agents/:id", async (c) => {
    await deps.store.agents.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/api/agents/:id/inbox", async (c) => {
    const inbox = await deps.bus.listInbox(c.req.param("id"), {
      status: parseStatuses(c.req.query("status")),
      limit: parseLimit(c.req.query("limit"), 50, 200),
      newestFirst: c.req.query("order") !== "asc",
    });
    return c.json({ inbox });
  });

  app.get("/api/chats", async (c) => {
    const agentId = c.req.query("agentId");
    const limit = parseLimit(c.req.query("limit"), 200, 500);
    const chats = agentId
      ? (await deps.store.chats.listByAgent(agentId)).slice(0, limit)
      : await deps.store.chats.list(limit);
    return c.json({ chats });
  });

  app.post("/api/chats", async (c) => {
    const input = parseBody(createChatSchema, await readJson(c));
    const chat = await deps.store.chats.create(input);
    return c.json({ chat }, 201);
  });

  app.get("/api/chats/:id", async (c) => {
    const chat = await requireChat(deps.store, c.req.param("id"));
    const agent = await deps.store.agents.get(chat.agentId);
    return c.json({
      chat,
      agent: agent ? { id: agent.id, name: agent.name, description: agent.description } : null,
    });
  });

  app.patch("/api/chats/:id", async (c) => {
    const id = c.req.param("id");
    const raw = await readJson(c);
    const chat = await requireChat(deps.store, id);
    if (raw && typeof raw === "object" && "agentId" in raw) rejectAgentRebind(chat);
    const input = parseBody(updateChatSchema, raw);
    const updated = await deps.store.chats.updateTitle(id, input.title);
    return c.json({ chat: updated });
  });

  app.get("/api/chats/:id/messages", async (c) => {
    const chat = await requireChat(deps.store, c.req.param("id"));
    const messages = await deps.store.messages.listByChat(chat.id);
    return c.json({ messages });
  });

  app.post("/api/chats/:id/messages", async (c) => {
    const chatId = c.req.param("id");
    const input = parseBody(postMessageSchema, await readJson(c));
    // Fail with a JSON status before the stream opens. runAgentTurn checks again.
    await prepareTurn(deps, {
      chatId,
      content: input.content,
      profileId: input.profileId,
      agentId: input.agentId,
      signal: c.req.raw.signal,
    });
    return streamSSE(c, async (stream) => {
      try {
        for await (const event of runAgentTurn(deps, {
          chatId,
          content: input.content,
          profileId: input.profileId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          signal: c.req.raw.signal,
          ...(deps.maxSteps ? { maxSteps: deps.maxSteps } : {}),
        })) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        const code = error instanceof BotanicalError ? error.code : "INTERNAL";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ type: "error", error: message, code }),
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ type: "done", finishReason: "error" }),
        });
      }
    });
  });

  app.post("/api/a2a/messages", async (c) => {
    const input = parseBody(sendAgentMessageSchema, await readJson(c));
    const message = await deps.bus.send(input);
    return c.json({ message }, 201);
  });

  app.get("/api/a2a/messages/:id", async (c) => {
    const message = await deps.bus.get(c.req.param("id"));
    if (!message) return c.json({ error: "Agent message not found", code: "NOT_FOUND" }, 404);
    return c.json({ message });
  });

  app.post("/api/a2a/poll", async (c) => {
    const delivered = await deps.bus.deliverPending({ limit: 100 });
    return c.json({ delivered });
  });

  app.get("/api/mcp", async (c) => {
    const servers = deps.mcp?.status ? await deps.mcp.status() : [];
    return c.json({ servers });
  });

  return app;
}

async function requireAgent(store: Store, id: string) {
  const agent = await store.agents.get(id);
  if (!agent) throw new AgentNotFoundError(id);
  return agent;
}

async function requireChat(store: Store, id: string) {
  const chat = await store.chats.get(id);
  if (!chat) throw new ChatNotFoundError(id);
  return chat;
}

function jsonError(c: Context, error: BotanicalError) {
  const body: Record<string, unknown> = { error: error.message, code: error.code };
  if (error instanceof ValidationError && error.details !== undefined) body.details = error.details;
  const status = error.status;
  if (status === 400 || status === 404 || status === 409 || status === 413) {
    return c.json(body, status);
  }
  return c.json(body, 500);
}

async function readJson(c: Context): Promise<unknown> {
  const length = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(length) && length > 1_000_000) {
    throw new ValidationError("Request body exceeds 1MB");
  }
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("Request body must be JSON");
  }
}

function parseBody<S extends ZodTypeAny>(schema: S, value: unknown): output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Invalid request body", result.error.flatten());
  return result.data as output<S>;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ValidationError(`limit must be an integer from 1 to ${max}`);
  }
  return parsed;
}

function parseStatuses(value: string | undefined): AgentMessageStatus[] | undefined {
  if (!value) return undefined;
  const statuses: AgentMessageStatus[] = [];
  for (const part of value.split(",")) {
    const status = part.trim();
    if (!status) continue;
    if (!STATUSES.has(status as AgentMessageStatus)) {
      throw new ValidationError(`Unknown message status "${status}"`);
    }
    statuses.push(status as AgentMessageStatus);
  }
  return statuses;
}

