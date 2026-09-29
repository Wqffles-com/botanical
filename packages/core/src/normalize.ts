import { normalizeAccent } from "./appearance";
import {
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  DEFAULT_AGENT_SHAPE,
  isAgentColor,
  isAgentIcon,
  isAgentPicture,
  isAgentShape,
  type AgentColor,
  type AgentShape,
} from "./agents";
import { BotanicalApiError } from "./errors";
import type {
  Agent,
  AgentMessage,
  AgentMessageStatus,
  Chat,
  ChatEvent,
  ChatMessage,
  ChatStreamEvent,
  DeploymentMode,
  Appearance,
  Health,
  LoginResult,
  Me,
  MessageRole,
  ModelProfile,
  QueuedMessage,
  TokenUsage,
  ToolCall,
} from "./types";
import { AGENT_MESSAGE_STATUSES } from "./types";

export function unwrapList(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of [...keys, "items", "data"]) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new BotanicalApiError("Expected a list in the response.", { status: 200, body });
}

export function unwrapEntity(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BotanicalApiError("Expected an object in the response.", { status: 200, body });
  }
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

export function normalizeMode(value: unknown): DeploymentMode | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/-/g, "_");
  if (upper === "SAAS" || upper === "HOSTED") return "SAAS";
  if (upper === "SELF_HOST" || upper === "SELFHOST" || upper === "OSS") return "SELF_HOST";
  return null;
}

function stringField(record: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function requireRecordId(record: Record<string, unknown>, label: string): string {
  const id = record.id ?? record.uuid;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new BotanicalApiError(`${label} is missing an id.`, { status: 200, body: record });
  }
  return String(id);
}

export function normalizeHealth(body: unknown): Health {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  let ok = true;
  if (typeof record.ok === "boolean") ok = record.ok;
  else if (typeof record.status === "string") ok = record.status === "ok" || record.status === "healthy";
  return {
    ok,
    mode: normalizeMode(record.mode ?? record.deploymentMode ?? record.deployment_mode),
    version: typeof record.version === "string" ? record.version : null,
    brandName: readBrandName(record.brand ?? record.brandName ?? record.brand_name),
  };
}

export function normalizeLogin(body: unknown): LoginResult {
  const record = body && typeof body === "object" ? (unwrapEntity(body, ["session", "auth"])) : {};
  const token = stringField(record, ["token", "accessToken", "access_token"]);
  const expiresRaw = record.expiresAt ?? record.expires_at;
  return {
    token,
    expiresAt: typeof expiresRaw === "string" ? expiresRaw : null,
    mode: normalizeMode(record.mode),
  };
}

export function normalizeMe(body: unknown): Me {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BotanicalApiError("Expected an object in the response.", { status: 200, body });
  }
  const record = body as Record<string, unknown>;
  if (record.authenticated === false) {
    throw new BotanicalApiError("Not signed in.", { status: 401, body });
  }
  const user = readAccountUser(record.user);
  return {
    authenticated: true,
    mode: normalizeMode(record.mode ?? record.deploymentMode ?? record.deployment_mode),
    brandName: readBrandName(record.brand ?? record.brandName ?? record.brand_name),
    user,
  };
}

function readAccountUser(value: unknown): import("./types").AccountUser | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const email = typeof record.email === "string" ? record.email : "";
  const displayName = typeof record.displayName === "string" ? record.displayName : "";
  const role = record.role === "admin" || record.role === "member" ? record.role : null;
  if (!id || !role) return null;
  return { id, email, displayName, role };
}

export function normalizeProfile(body: unknown): ModelProfile {
  const record = unwrapEntity(body, ["profile"]);
  const kind = record.kind === "cli" ? "cli" : record.kind === "api" ? "api" : undefined;
  const available = typeof record.available === "boolean" ? record.available : undefined;
  const profile: ModelProfile = {
    id: requireRecordId(record, "Profile"),
    name: stringField(record, ["name", "label"], stringField(record, ["id"])),
    provider: stringField(record, ["provider", "providerId", "provider_id"]),
    model: stringField(record, ["model", "modelId", "model_id"]),
    description: nullableString(record.description),
  };
  if (kind) profile.kind = kind;
  if (available !== undefined) profile.available = available;
  if (typeof record.unavailableReason === "string") profile.unavailableReason = record.unavailableReason;
  if (typeof record.cli === "string") profile.cli = record.cli;
  return profile;
}

export function normalizeMemory(body: unknown): import("./types").MemoryRecord {
  const record = unwrapEntity(body, ["memory"]);
  const scope = record.scope === "agent" ? "agent" : "shared";
  const createdAt = stringField(record, ["createdAt", "created_at"]);
  const tags = Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return {
    id: requireRecordId(record, "Memory"),
    scope,
    agentId: nullableString(record.agentId ?? record.agent_id),
    content: stringField(record, ["content"]),
    tags,
    createdAt,
    updatedAt: stringField(record, ["updatedAt", "updated_at"], createdAt),
  };
}

export function normalizeRoleRecord(body: unknown): import("./types").RoleRecord {
  const record = unwrapEntity(body, ["role"]);
  const createdAt = stringField(record, ["createdAt", "created_at"]);
  return {
    id: requireRecordId(record, "Role"),
    name: stringField(record, ["name"]),
    description: stringField(record, ["description"]),
    permissions: normalizePermissions(record.permissions),
    builtin: record.builtin === true,
    createdAt,
    updatedAt: stringField(record, ["updatedAt", "updated_at"], createdAt),
  };
}

export function normalizeAgent(body: unknown): Agent {
  const record = unwrapEntity(body, ["agent"]);
  const createdAt = stringField(record, ["createdAt", "created_at"]);
  const systemPrompt = stringField(record, ["systemPrompt", "system_prompt", "prompt"]);
  const toolIds = normalizeToolIds(record.toolIds ?? record.tool_ids ?? record.tools);
  return {
    id: requireRecordId(record, "Agent"),
    name: stringField(record, ["name"], "Agent"),
    title: stringField(record, ["title"]).slice(0, 60),
    icon: normalizeIcon(record.icon),
    shape: normalizeShape(record.shape),
    picture: normalizePicture(record.picture),
    color: normalizeColor(record.color),
    description: stringField(record, ["description"]),
    systemPrompt,
    prompt: systemPrompt,
    toolIds,
    tools: toolIds,
    defaultProfileId: normalizeDefaultProfileId(record.defaultProfileId ?? record.default_profile_id),
    createdByAgentId: nullableString(record.createdByAgentId ?? record.created_by_agent_id),
    roleIds: normalizeToolIds(record.roleIds ?? record.role_ids),
    roles: normalizeRoles(record.roles),
    effectivePermissions: normalizeEffective(record.effectivePermissions ?? record.effective_permissions),
    createdAt,
    updatedAt: stringField(record, ["updatedAt", "updated_at"], createdAt),
  };
}

function normalizeRoles(value: unknown): Agent["roles"] {
  if (!Array.isArray(value)) return [];
  const roles: Agent["roles"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = stringField(record, ["id"]);
    if (!id) continue;
    roles.push({
      id,
      name: stringField(record, ["name"], id),
      builtin: record.builtin === true,
      permissions: normalizePermissions(record.permissions),
    });
  }
  return roles;
}

function normalizePermissions(value: unknown): Agent["roles"][number]["permissions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { capabilities: [], mcp: [] };
  const record = value as Record<string, unknown>;
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((item): item is string => typeof item === "string")
    : [];
  const mcp = Array.isArray(record.mcp)
    ? record.mcp.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const grant = item as Record<string, unknown>;
        if (typeof grant.server !== "string" || grant.server.trim() === "") return [];
        const tools = Array.isArray(grant.tools)
          ? grant.tools.filter((tool): tool is string => typeof tool === "string")
          : undefined;
        return [{ server: grant.server, ...(tools && tools.length > 0 ? { tools } : {}) }];
      })
    : [];
  return { capabilities, mcp };
}

function normalizeEffective(value: unknown): Agent["effectivePermissions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { unrestricted: true, capabilities: [], mcp: [], roleNames: [] };
  }
  const record = value as Record<string, unknown>;
  const permissions = normalizePermissions(record);
  const roleNames = Array.isArray(record.roleNames)
    ? record.roleNames.filter((item): item is string => typeof item === "string")
    : [];
  return {
    unrestricted: record.unrestricted !== false && roleNames.length === 0 && permissions.capabilities.length === 0,
    capabilities: permissions.capabilities,
    mcp: permissions.mcp,
    roleNames,
  };
}

function normalizeIcon(value: unknown): string {
  if (typeof value === "string" && isAgentIcon(value.trim())) return value.trim();
  return DEFAULT_AGENT_ICON;
}

function normalizeColor(value: unknown): AgentColor {
  if (isAgentColor(value)) return value;
  return DEFAULT_AGENT_COLOR;
}

function normalizeShape(value: unknown): AgentShape {
  if (isAgentShape(value)) return value;
  return DEFAULT_AGENT_SHAPE;
}

function normalizePicture(value: unknown): string | null {
  return isAgentPicture(value) ? value : null;
}

export function normalizeAppearance(body: unknown): Appearance {
  const record = unwrapEntity(body, ["appearance"]);
  return { accent: normalizeAccent(record.accent) };
}

function normalizeDefaultProfileId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function normalizeChat(body: unknown): Chat {
  const record = unwrapEntity(body, ["chat"]);
  const createdAt = stringField(record, ["createdAt", "created_at"]);
  const profile = stringField(record, ["profileId", "profile_id"]);
  return {
    id: requireRecordId(record, "Chat"),
    agentId: stringField(record, ["agentId", "agent_id"]),
    memberIds: stringList(record.memberIds ?? record.member_ids),
    profileId: profile || null,
    title: stringField(record, ["title"], "Untitled chat") || "Untitled chat",
    createdAt,
    updatedAt: stringField(record, ["updatedAt", "updated_at"], createdAt),
  };
}

export function normalizeAgentMessage(body: unknown): AgentMessage {
  const record = unwrapEntity(body, ["message", "agentMessage"]);
  const createdAt = stringField(record, ["createdAt", "created_at"]);
  const status = normalizeAgentMessageStatus(record.status);
  const message: AgentMessage = {
    id: requireRecordId(record, "Agent message"),
    fromAgentId: stringField(record, ["fromAgentId", "from_agent", "from_agent_id"]),
    toAgentId: stringField(record, ["toAgentId", "to_agent", "to_agent_id"]),
    body: stringField(record, ["body", "content", "preview"]),
    status,
    createdAt,
    updatedAt: stringField(record, ["updatedAt", "updated_at"], createdAt),
  };
  const fromChatId = stringField(record, ["fromChatId", "from_chat_id"]);
  if (fromChatId) message.fromChatId = fromChatId;
  const deliveredAt = stringField(record, ["deliveredAt", "delivered_at"]);
  if (deliveredAt) message.deliveredAt = deliveredAt;
  const readAt = stringField(record, ["readAt", "read_at"]);
  if (readAt) message.readAt = readAt;
  const error = stringField(record, ["error"]);
  if (error) message.error = error;
  return message;
}

function normalizeAgentMessageStatus(value: unknown): AgentMessageStatus {
  if (typeof value === "string" && (AGENT_MESSAGE_STATUSES as readonly string[]).includes(value)) {
    return value as AgentMessageStatus;
  }
  return "pending";
}

export function normalizeMessage(body: unknown): ChatMessage {
  const record = unwrapEntity(body, ["message"]);
  const usage = normalizeUsage(record.usage);
  const toolCalls = normalizeToolCalls(record.toolCalls ?? record.tool_calls);
  const toolCallId = stringField(record, ["toolCallId", "tool_call_id"]);
  const name = stringField(record, ["name"]);
  const profileId = stringField(record, ["profileId", "profile_id"]);
  const agentId = stringField(record, ["agentId", "agent_id"]);
  return {
    id: requireRecordId(record, "Message"),
    chatId: stringField(record, ["chatId", "chat_id"]),
    role: normalizeRole(record.role),
    content: normalizeContent(record.content),
    createdAt: stringField(record, ["createdAt", "created_at"]),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(name ? { name } : {}),
    ...(profileId ? { profileId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function normalizeToolIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item === "number") return String(item);
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (typeof record.id === "string") return record.id;
          if (typeof record.name === "string") return record.name;
        }
        return "";
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") return Object.keys(value as object);
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeToolIds(JSON.parse(value) as unknown);
    } catch {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function normalizeContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (typeof record.content === "string") return record.content;
        }
        return "";
      })
      .join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
  }
  return "";
}

function normalizeRole(value: unknown): MessageRole {
  const role = typeof value === "string" ? value : "assistant";
  if (role === "model") return "assistant";
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") return role;
  return "assistant";
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = stringField(record, ["name"]);
      if (!name) return null;
      return {
        id: stringField(record, ["id"], `tool-${index}`),
        name,
        arguments: parseMaybeJson(record.arguments ?? record.args ?? {}),
      } satisfies ToolCall;
    })
    .filter((item): item is ToolCall => item !== null);
}

function normalizeUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inputTokens = numberField(record.inputTokens ?? record.input_tokens);
  const outputTokens = numberField(record.outputTokens ?? record.output_tokens);
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function coerceStreamEvent(parsed: unknown, eventName = ""): ChatStreamEvent | null {
  if (typeof parsed === "string") {
    if (eventName === "error") return { type: "error", error: parsed };
    if (eventName === "done" || eventName === "finish") return { type: "done" };
    if (parsed === "[DONE]") return { type: "done" };
    return { type: "text-delta", text: parsed };
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const type = (eventName || (typeof record.type === "string" ? record.type : "")).trim();
  switch (type) {
    case "message-start":
    case "message.start":
      return messageStart(record, record);
    case "message.created":
      return messageStart(messageRecord(record) ?? record, messageRecord(record) ?? record);
    case "message.completed":
    case "message.complete": {
      const inner = messageRecord(record) ?? record;
      const messageId = stringField(inner, ["id", "messageId", "message_id"]);
      return messageId ? { type: "done", messageId } : { type: "done" };
    }
    case "text-delta":
    case "text.delta":
    case "delta":
      return { type: "text-delta", text: stringField(record, ["text", "delta", "content"]) };
    case "tool-call":
    case "tool.call":
    case "tool_call":
      return {
        type: "tool-call",
        id: stringField(record, ["id", "toolCallId", "tool_call_id"]),
        name: stringField(record, ["name"]),
        arguments: parseMaybeJson(record.arguments ?? record.args ?? {}),
      };
    case "tool-result":
    case "tool.result":
    case "tool_result": {
      const isError = record.isError === true;
      return {
        type: "tool-result",
        id: stringField(record, ["id", "toolCallId", "tool_call_id"]),
        content: normalizeContent(record.content ?? record.result ?? record.text),
        ...(isError ? { isError: true } : {}),
      };
    }
    case "usage":
      return {
        type: "usage",
        inputTokens: numberField(record.inputTokens ?? record.input_tokens) ?? 0,
        outputTokens: numberField(record.outputTokens ?? record.output_tokens) ?? 0,
      };
    case "error":
      return {
        type: "error",
        error:
          typeof record.error === "string"
            ? record.error
            : stringField(record, ["message", "text"], "Stream error"),
      };
    case "done":
    case "finish": {
      const messageId = stringField(record, ["messageId", "message_id", "id"]);
      return messageId ? { type: "done", messageId } : { type: "done" };
    }
    default:
      if (!type && typeof record.text === "string") return { type: "text-delta", text: record.text };
      return null;
  }
}

export function* eventsFromFinalMessage(body: unknown): Generator<ChatStreamEvent> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (record.assistantMessage && typeof record.assistantMessage === "object") {
      yield* eventsFromSingleMessage(record.assistantMessage);
      return;
    }
  }
  yield* eventsFromSingleMessage(body);
}

function* eventsFromSingleMessage(body: unknown): Generator<ChatStreamEvent> {
  const message = normalizeMessage(body);
  if (message.id) yield { type: "message-start", messageId: message.id, role: message.role };
  if (message.content) yield { type: "text-delta", text: message.content };
  for (const call of message.toolCalls ?? []) {
    yield { type: "tool-call", id: call.id, name: call.name, arguments: call.arguments };
  }
  if (message.usage) {
    yield {
      type: "usage",
      inputTokens: message.usage.inputTokens,
      outputTokens: message.usage.outputTokens,
    };
  }
  yield message.id ? { type: "done", messageId: message.id } : { type: "done" };
}

function messageRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) return message as Record<string, unknown>;
  return null;
}

function messageStart(idSource: Record<string, unknown>, roleSource: Record<string, unknown>): ChatStreamEvent {
  const messageId = stringField(idSource, ["messageId", "message_id", "id"]);
  const role = optionalRole(roleSource.role);
  return role ? { type: "message-start", messageId, role } : { type: "message-start", messageId };
}

function optionalRole(value: unknown): MessageRole | null {
  if (value === "model") return "assistant";
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") return value;
  return null;
}

function readBrandName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    const name = (value as { name: string }).name.trim();
    return name || null;
  }
  return null;
}

export function normalizeQueuedMessage(body: unknown): QueuedMessage {
  const record = unwrapEntity(body, ["queued"]);
  return {
    id: stringField(record, ["id"]),
    content: stringField(record, ["content"]),
    profileId: stringField(record, ["profileId", "profile_id"]),
    createdAt: stringField(record, ["createdAt", "created_at"]),
  };
}

/** One `GET /api/chats/:id/events` message. Unknown names return null. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function normalizeChatEvent(event: string, data: unknown): ChatEvent | null {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  if (event === "status") {
    const queued = Array.isArray(record.queued) ? record.queued.map(normalizeQueuedMessage) : [];
    const agentId = stringField(record, ["agentId"]);
    return { type: "status", running: record.running === true, queued, ...(agentId ? { agentId } : {}) };
  }
  if (event === "message" && record.message) {
    const queuedId = stringField(record, ["queuedId"]);
    return { type: "message", message: normalizeMessage(record.message), ...(queuedId ? { queuedId } : {}) };
  }
  if (event === "message-updated" && record.message) {
    return { type: "message-updated", message: normalizeMessage(record.message) };
  }
  if (event === "messages-deleted") {
    const ids = Array.isArray(record.ids) ? record.ids.filter((id): id is string => typeof id === "string") : [];
    return { type: "messages-deleted", ids };
  }
  if (event === "error") {
    return {
      type: "error",
      error: stringField(record, ["error", "message"], "The model request failed"),
      code: stringField(record, ["code"], "error"),
    };
  }
  return null;
}
