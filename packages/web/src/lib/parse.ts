import { BotanicalApiError } from "@botanical/core";
import { providerLabel } from "./format-extra";
import type { DeploymentMode } from "@botanical/core";
import {
  AGENT_COLORS,
  AGENT_MESSAGE_STATUSES,
  KNOWN_PROVIDERS,
  type AgentColor,
  type AgentIdentity,
  type AgentMessage,
  type AgentMessageStatus,
  type AppSettings,
  type CatalogTool,
  type McpServerRow,
  type McpServerState,
  type McpSnapshot,
  type ProviderKeyStatus,
} from "./mvp-types";

function unwrapList(body: unknown, keys: string[]): unknown[] {
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

function normalizeMode(value: unknown): DeploymentMode | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/-/g, "_");
  if (upper === "SAAS" || upper === "HOSTED") return "SAAS";
  if (upper === "SELF_HOST" || upper === "SELFHOST" || upper === "OSS") return "SELF_HOST";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringField(record: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function numberField(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

function readBrandName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    const name = (value as { name: string }).name.trim();
    return name || null;
  }
  return null;
}

export function parseAgentIdentity(body: unknown): AgentIdentity {
  const record = asRecord(body);
  const colorRaw = stringField(record, ["color", "accent"]).toLowerCase();
  const color = (AGENT_COLORS as readonly string[]).includes(colorRaw) ? (colorRaw as AgentColor) : "green";
  return {
    id: stringField(record, ["id", "uuid"]),
    name: stringField(record, ["name"], "Agent"),
    description: stringField(record, ["description"]),
    icon: stringField(record, ["icon"], "Bot") || "Bot",
    color,
  };
}

export function parseAgentList(body: unknown): AgentIdentity[] {
  try {
    return unwrapList(body, ["agents"]).map(parseAgentIdentity).filter((agent) => agent.id);
  } catch (error) {
    if (error instanceof BotanicalApiError) return [];
    throw error;
  }
}

export function parseCatalogTool(body: unknown): CatalogTool {
  const record = asRecord(body);
  const sourceRaw = stringField(record, ["source", "origin"]).toLowerCase();
  const source = sourceRaw === "mcp" ? "mcp" : "builtin";
  const id = stringField(record, ["id", "name", "canonicalName", "canonical_name", "providerName", "provider_name"]);
  return {
    id,
    name: stringField(record, ["name", "title", "id"], id),
    description: stringField(record, ["description"]),
    source,
    serverId:
      source === "mcp"
        ? nullable(stringField(record, ["serverId", "server_id", "mcpServerId", "sourceId", "source_id", "server"]))
        : null,
    risk: nullable(stringField(record, ["risk"])),
  };
}

export function parseToolList(body: unknown): CatalogTool[] {
  try {
    return unwrapList(body, ["tools", "catalog"])
      .map(parseCatalogTool)
      .filter((tool) => tool.id || tool.name);
  } catch (error) {
    if (missingEndpoint(error)) return [];
    throw error;
  }
}

const MCP_STATES: readonly McpServerState[] = ["ready", "error", "closed", "disabled", "connecting", "unknown"];

export function parseMcpServer(body: unknown): McpServerRow {
  const record = asRecord(body);
  const stateRaw = stringField(record, ["state", "status"]).toLowerCase();
  const state = (MCP_STATES as readonly string[]).includes(stateRaw) ? (stateRaw as McpServerState) : "unknown";
  return {
    id: stringField(record, ["id", "serverId", "server_id"]),
    transport: stringField(record, ["transport", "kind"], "unknown"),
    state,
    toolCount: numberField(record, ["toolCount", "tool_count", "tools"]),
    serverName: nullable(stringField(record, ["serverName", "server_name", "name"])),
    error: nullable(stringField(record, ["error", "message"])),
  };
}

export function parseMcpServers(body: unknown): McpServerRow[] {
  return parseMcpSnapshot(body).servers;
}

export function parseMcpSnapshot(body: unknown): McpSnapshot {
  const record = asRecord(body);
  let servers: McpServerRow[] = [];
  try {
    servers = unwrapList(body, ["servers", "mcpServers"]).map(parseMcpServer).filter((row) => row.id);
  } catch (error) {
    if (!missingEndpoint(error) && !(error instanceof BotanicalApiError)) throw error;
  }
  return {
    disabled: record.disabled === true,
    source: stringField(record, ["source"], "unknown"),
    configError: nullable(stringField(record, ["configError", "config_error", "error"])),
    servers,
  };
}

export function parseAgentMessage(body: unknown): AgentMessage {
  const record = asRecord(body);
  const nested = asRecord(record.message);
  const src = nested.id ? nested : record;
  const statusRaw = stringField(src, ["status"]).toLowerCase();
  const status = (AGENT_MESSAGE_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as AgentMessageStatus)
    : src.read === true
      ? "read"
      : "pending";
  return {
    id: stringField(src, ["id"]),
    fromAgentId: stringField(src, ["fromAgentId", "from_agent_id", "fromAgent", "from_agent"]),
    toAgentId: stringField(src, ["toAgentId", "to_agent_id", "toAgent", "to_agent"]),
    body: stringField(src, ["body", "content", "preview", "text"]),
    status,
    createdAt: stringField(src, ["createdAt", "created_at"]),
  };
}

export function parseAgentMessages(body: unknown): AgentMessage[] {
  try {
    return unwrapList(body, ["messages", "agentMessages"])
      .map(parseAgentMessage)
      .filter((message) => message.id);
  } catch (error) {
    if (missingEndpoint(error)) return [];
    throw error;
  }
}

export function parseSettings(body: unknown, fallback: Partial<AppSettings> = {}): AppSettings {
  const record = asRecord(body);
  const featuresRaw = record.features ?? record.featureFlags ?? record.feature_flags;
  const features: Record<string, boolean> = {};
  if (featuresRaw && typeof featuresRaw === "object" && !Array.isArray(featuresRaw)) {
    for (const [key, value] of Object.entries(featuresRaw as Record<string, unknown>)) {
      if (typeof value === "boolean") features[key] = value;
    }
  }
  return {
    deploymentMode: normalizeMode(record.deploymentMode ?? record.deployment_mode ?? record.mode) ?? fallback.deploymentMode ?? null,
    brandName: readBrandName(record.brand ?? record.brandName ?? record.brand_name) ?? fallback.brandName ?? null,
    version: typeof record.version === "string" ? record.version : (fallback.version ?? null),
    features,
    providers: parseProviderKeys(record.providers ?? record.providerKeys ?? record.provider_keys),
  };
}

export function parseProviderKeys(value: unknown): ProviderKeyStatus[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const id = stringField(record, ["id", "provider", "providerId", "provider_id"]).toLowerCase();
      if (!id) return null;
      const configured =
        record.configured === true ||
        record.keyConfigured === true ||
        record.hasKey === true ||
        record.has_key === true;
      return {
        id,
        label: stringField(record, ["label", "name"], providerLabel(id)),
        configured,
      } satisfies ProviderKeyStatus;
    })
    .filter((row): row is ProviderKeyStatus => row !== null);
}

/** Profiles listed by GET /api/profiles already imply a configured provider key (plus mock). */
export function deriveProviderKeys(
  profiles: { provider: string }[],
  fromSettings: ProviderKeyStatus[],
): ProviderKeyStatus[] {
  const configured = new Set<string>();
  for (const row of fromSettings) if (row.configured) configured.add(row.id);
  for (const profile of profiles) {
    const id = profile.provider.trim().toLowerCase();
    if (id) configured.add(id);
  }
  configured.add("mock");
  const byId = new Map<string, ProviderKeyStatus>();
  for (const known of KNOWN_PROVIDERS) {
    byId.set(known.id, { ...known, configured: configured.has(known.id) || known.id === "mock" });
  }
  for (const row of fromSettings) {
    const prev = byId.get(row.id);
    byId.set(row.id, {
      id: row.id,
      label: row.label || prev?.label || providerLabel(row.id),
      configured: row.configured || configured.has(row.id),
    });
  }
  for (const id of configured) {
    if (!byId.has(id)) byId.set(id, { id, label: providerLabel(id), configured: true });
  }
  return [...byId.values()];
}

export function filterMessagesByAgent(messages: AgentMessage[], agentId: string | "all"): AgentMessage[] {
  if (!agentId || agentId === "all") return messages;
  return messages.filter((message) => message.fromAgentId === agentId || message.toAgentId === agentId);
}

export function missingEndpoint(error: unknown): boolean {
  return error instanceof BotanicalApiError && (error.status === 404 || error.status === 405 || error.status === 501);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
