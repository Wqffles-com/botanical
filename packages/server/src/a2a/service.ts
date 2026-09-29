import {
  AgentNotFoundError,
  ValidationError,
  createAgentMessageBus,
  renderInbox,
  type AgentMessageBus,
  type AgentMessageRecord,
  type AgentRepository as RuntimeAgentRepository,
  type RuntimeDeps,
} from "@botanical/agent-runtime";

import { HttpError } from "../http.ts";
import { ensureAgentChat, findAgentChat } from "../runtime/agent-chat.ts";
import type { Agent, AgentMessage, AgentMessageStatus, Message, ModelProfile, Store } from "../types.ts";
import { AGENT_MESSAGE_STATUSES } from "../types.ts";
import { collectChatTurn } from "../runtime/turn.ts";
import { A2A_BODY_MAX } from "./constants.ts";

const DELIVER_BATCH = 100;
const INBOX_BATCH = 50;

const ALLOWED_TRANSITIONS: Record<AgentMessageStatus, readonly AgentMessageStatus[]> = {
  pending: ["pending", "delivered", "failed"],
  delivered: ["delivered", "read", "failed"],
  read: ["read"],
  failed: ["failed"],
};

export interface SendA2AInput {
  fromAgentId: string;
  toAgentId?: string;
  toAgentName?: string;
  body: string;
  fromChatId?: string;
}

export interface ListA2AOptions {
  status?: AgentMessageStatus[];
  limit?: number;
}

export interface A2AService {
  send(input: SendA2AInput): Promise<AgentMessage>;
  list(agentId: string, opts?: ListA2AOptions): Promise<AgentMessage[]>;
  updateStatus(id: string, status: AgentMessageStatus): Promise<AgentMessage>;
  /** Resolves when queued inbox turns have finished. */
  whenIdle(): Promise<void>;
}

export interface A2AServiceOptions {
  store: Store;
  autorun: boolean;
  profiles: readonly ModelProfile[];
  /** Runs the recipient's real agent turn. Resolved lazily: the runtime is built after this service. */
  runtime: () => RuntimeDeps;
  /** Serialize inbox writes with any other turn on the same chat. */
  exclusive?: <T>(chatId: string, fn: () => Promise<T>) => Promise<T>;
  /** Told about each message an inbox turn stores, so an open chat shows it. */
  onMessage?: (message: Message) => void;
}

/**
 * A2A API on top of the agent-runtime bus.
 * `send` persists a pending row, then delivers it. When `autorun` is set,
 * the recipient is woken with a real agent turn in its own chat (one chat per agent),
 * with the rendered inbox as the user message.
 */
export function createA2AService(options: A2AServiceOptions): A2AService {
  const { store, autorun, profiles, runtime, exclusive, onMessage } = options;
  const bus = createAgentMessageBus(runtimeAgents(store), store.agentMessages);
  let tail: Promise<void> = Promise.resolve();

  function schedule(agentId: string): void {
    if (!autorun) return;
    tail = tail
      .then(() => runInboxTurn(store, bus, profiles, runtime, agentId, exclusive, onMessage))
      .catch((error: unknown) => {
        console.error("[a2a] inbox turn failed", error);
      });
  }

  return {
    async send(input) {
      const fromAgentId = requiredId(input.fromAgentId, "fromAgentId");
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!body) throw new HttpError(400, "invalid_body", "body is required");
      if (body.length > A2A_BODY_MAX) {
        throw new HttpError(400, "invalid_body", `body must be at most ${A2A_BODY_MAX} characters`);
      }

      const requestedId = clean(input.toAgentId);
      const requestedName = clean(input.toAgentName);
      if (!requestedId && !requestedName) {
        throw new HttpError(400, "invalid_body", "toAgentId or toAgentName is required");
      }

      let toAgentId = requestedId;
      if (!toAgentId && requestedName) {
        const match = await findAgentByName(store, requestedName);
        if (!match) throw new HttpError(404, "not_found", `Agent not found: ${requestedName}`);
        toAgentId = match.id;
      }
      if (!toAgentId) {
        throw new HttpError(400, "invalid_body", "toAgentId or toAgentName is required");
      }
      if (toAgentId === fromAgentId) {
        throw new HttpError(400, "invalid_body", "An agent cannot message itself");
      }

      const fromChatId = clean(input.fromChatId);
      if (fromChatId) {
        const chat = await store.chats.get(fromChatId);
        if (!chat) throw new HttpError(404, "not_found", "Chat not found");
        if (chat.agentId !== fromAgentId) {
          throw new HttpError(400, "invalid_body", "fromChatId is not owned by fromAgentId");
        }
      }

      let pending: AgentMessageRecord;
      try {
        pending = await bus.send({
          fromAgentId,
          toAgentId,
          body,
          ...(fromChatId ? { fromChatId } : {}),
        });
      } catch (error) {
        throw mapBusError(error);
      }

      const delivered = await deliverMessage(bus, pending);
      if (autorun && delivered.status === "delivered") schedule(delivered.toAgentId);
      return present(delivered);
    },

    async list(agentId, opts) {
      try {
        const messages = await bus.listInbox(agentId, {
          ...(opts?.status ? { status: opts.status } : {}),
          limit: opts?.limit ?? 50,
          newestFirst: true,
        });
        return messages.map((message) => present(message));
      } catch (error) {
        throw mapBusError(error);
      }
    },

    async updateStatus(id, status) {
      if (!(AGENT_MESSAGE_STATUSES as readonly string[]).includes(status)) {
        throw new HttpError(400, "invalid_body", "status must be pending, delivered, read, or failed");
      }
      const current = await store.agentMessages.get(id);
      if (!current) throw new HttpError(404, "not_found", "Agent message not found");
      if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
        throw new HttpError(
          409,
          "invalid_status",
          `Cannot change status from ${current.status} to ${status}`,
        );
      }
      if (current.status === status) return present(current);
      const updated = await store.agentMessages.updateStatus(id, status);
      if (!updated) throw new HttpError(404, "not_found", "Agent message not found");
      if (autorun && current.status === "pending" && updated.status === "delivered") {
        schedule(updated.toAgentId);
      }
      return present(updated);
    },

    whenIdle() {
      return tail;
    },
  };
}

async function deliverMessage(bus: AgentMessageBus, pending: AgentMessageRecord): Promise<AgentMessageRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const batch = await bus.deliverPending({ toAgentId: pending.toAgentId, limit: DELIVER_BATCH });
    const found = batch.find((message) => message.id === pending.id);
    if (found) return found;
    if (batch.length === 0) break;
  }
  return (await bus.get(pending.id)) ?? pending;
}

async function runInboxTurn(
  store: Store,
  bus: AgentMessageBus,
  profiles: readonly ModelProfile[],
  runtime: () => RuntimeDeps,
  agentId: string,
  exclusive?: <T>(chatId: string, fn: () => Promise<T>) => Promise<T>,
  onMessage?: (message: Message) => void,
): Promise<void> {
  const agent = await store.agents.get(agentId);
  if (!agent) return;

  const profile = await resolveInboxProfile(store, profiles, agent);
  if (!profile) return;
  const names = new Map((await store.agents.list()).map((row) => [row.id, row.name]));
  const seen = new Set<string>();
  let chatId: string | null = null;
  let wrote = false;

  try {
    for (let batch = 0; batch < 20; batch += 1) {
      await bus.deliverPending({ toAgentId: agentId, limit: DELIVER_BATCH });
      const waiting = (await bus.listInbox(agentId, { status: ["delivered"], limit: INBOX_BATCH })).filter(
        (message) => !seen.has(message.id),
      );
      if (waiting.length === 0) break;
      for (const message of waiting) seen.add(message.id);

      if (!chatId) {
        const { chat } = await ensureAgentChat(store, agent, profile.id);
        chatId = chat.id;
      }
      const claimed = await bus.markRead(waiting.map((message) => message.id));
      if (claimed.length === 0) break;
      claimed.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

      const content = renderInbox(claimed, names);
      const write = async () => {
        const chat = await store.chats.get(chatId!);
        if (!chat) throw new Error("Inbox chat not found");
        const result = await collectChatTurn(store, runtime(), { chat, content, profile });
        onMessage?.(result.userMessage);
        if (result.assistantMessage) onMessage?.(result.assistantMessage);
        if (result.error) throw new Error(result.error.message);
      };
      if (exclusive) await exclusive(chatId, write);
      else await write();
      wrote = true;
    }
    if (wrote && chatId) {
      await store.notifications
        .create({
          kind: "run_succeeded",
          title: `Inbox · ${agent.name}`,
          body: "Background inbox turn finished.",
          agentId,
          chatId,
        })
        .catch((error: unknown) => {
          console.error("[a2a] notification failed", error);
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inbox turn failed";
    await store.notifications
      .create({
        kind: "run_failed",
        title: `Inbox · ${agent.name}`,
        body: message.slice(0, 2_000),
        agentId,
        ...(chatId ? { chatId } : {}),
      })
      .catch(() => undefined);
    throw error;
  }
}

async function resolveInboxProfile(
  store: Store,
  profiles: readonly ModelProfile[],
  agent: Agent,
): Promise<ModelProfile | null> {
  const known = (id: string | undefined): ModelProfile | null => {
    if (!id) return null;
    return profiles.find((profile) => profile.id === id) ?? null;
  };

  // The agent's own chat keeps the profile it last ran on; before its first chat, the agent's default.
  const own = await findAgentChat(store, agent.id);
  return known(own?.profileId ?? undefined) ?? known(readDefaultProfileId(agent));
}

function readDefaultProfileId(agent: Agent): string | undefined {
  const value = (agent as Agent & { defaultProfileId?: unknown }).defaultProfileId;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function runtimeAgents(store: Store): RuntimeAgentRepository {
  return {
    async get(id) {
      const agent = await store.agents.get(id);
      return agent ? toRuntimeAgent(agent) : null;
    },
    async getByName(name) {
      const agent = await findAgentByName(store, name);
      return agent ? toRuntimeAgent(agent) : null;
    },
    async list(limit = 200) {
      const agents = await store.agents.list();
      return agents.slice(0, limit).map(toRuntimeAgent);
    },
    async create() {
      throw new Error("A2A agent adapter does not create agents");
    },
    async update() {
      throw new Error("A2A agent adapter does not update agents");
    },
    async delete() {
      throw new Error("A2A agent adapter does not delete agents");
    },
  };
}

function toRuntimeAgent(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    prompt: agent.systemPrompt,
    toolAllowlist: [...agent.toolIds],
    a2aEnabled: true,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function findAgentByName(store: Store, name: string): Promise<Agent | null> {
  const matches = (await store.agents.list())
    .filter((agent) => agent.name === name)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}

function present(message: AgentMessageRecord & { updatedAt?: string }): AgentMessage {
  const presented: AgentMessage = {
    id: message.id,
    fromAgentId: message.fromAgentId,
    toAgentId: message.toAgentId,
    body: message.body,
    status: message.status,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? message.createdAt,
  };
  if (message.fromChatId) presented.fromChatId = message.fromChatId;
  if (message.deliveredAt) presented.deliveredAt = message.deliveredAt;
  if (message.readAt) presented.readAt = message.readAt;
  if (message.error) presented.error = message.error;
  return presented;
}

function mapBusError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof AgentNotFoundError) {
    throw new HttpError(404, "not_found", error.message);
  }
  if (error instanceof ValidationError) {
    throw new HttpError(400, "invalid_body", error.message);
  }
  throw error;
}

function requiredId(value: string | undefined, field: string): string {
  const id = clean(value);
  if (!id) throw new HttpError(400, "invalid_body", `${field} is required`);
  return id;
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
