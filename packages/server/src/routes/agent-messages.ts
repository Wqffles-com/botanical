import type { A2AService } from "../a2a/service.ts";
import { A2A_BODY_MAX } from "../a2a/constants.ts";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { AgentMessageStatus } from "../types.ts";
import { AGENT_MESSAGE_STATUSES } from "../types.ts";
import { LIMITS, readBoundedString, readRequiredId, requireParam } from "../validate.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function registerAgentMessages(router: Router, a2a: A2AService): void {
  router.add(
    "GET",
    "/api/agent-messages",
    authed(async (ctx) => {
      const agentId = ctx.url.searchParams.get("agentId");
      if (agentId === null || agentId.trim() === "" || agentId.trim().length > LIMITS.id) {
        throw new HttpError(400, "invalid_query", "agentId is required");
      }
      const messages = await a2a.list(agentId.trim(), {
        ...statusOption(ctx.url.searchParams.get("status")),
        limit: readLimit(ctx.url.searchParams.get("limit")),
      });
      return json(200, { messages });
    }),
  );

  router.add(
    "POST",
    "/api/agent-messages",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const fromAgentId = readRequiredId(body.fromAgentId, "fromAgentId");
      const toAgentId = readRequiredId(body.toAgentId, "toAgentId");
      const text = readBoundedString(body.body, "body", { required: true, max: A2A_BODY_MAX });
      if (!text) throw new HttpError(400, "invalid_body", "body is required");
      const fromChatId =
        body.fromChatId === undefined ? undefined : readRequiredId(body.fromChatId, "fromChatId");
      const message = await a2a.send({
        fromAgentId,
        toAgentId,
        body: text,
        ...(fromChatId ? { fromChatId } : {}),
      });
      return json(201, { message });
    }),
  );

  router.add(
    "PATCH",
    "/api/agent-messages/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      if (!isStatus(body.status)) {
        throw new HttpError(400, "invalid_body", "status must be pending, delivered, read, or failed");
      }
      const message = await a2a.updateStatus(id, body.status);
      return json(200, { message });
    }),
  );
}

function statusOption(raw: string | null): { status?: AgentMessageStatus[] } {
  if (raw === null || raw.trim() === "") return {};
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return {};
  const statuses: AgentMessageStatus[] = [];
  for (const part of parts) {
    if (!isStatus(part)) {
      throw new HttpError(400, "invalid_query", "status must be pending, delivered, read, or failed");
    }
    statuses.push(part);
  }
  return { status: statuses };
}

function readLimit(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw.trim())) {
    throw new HttpError(400, "invalid_query", "limit must be an integer");
  }
  const limit = Number(raw.trim());
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, "invalid_query", `limit must be between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function isStatus(value: unknown): value is AgentMessageStatus {
  return typeof value === "string" && (AGENT_MESSAGE_STATUSES as readonly string[]).includes(value);
}
