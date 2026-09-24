/**
 * Three ids for one MCP tool:
 *
 * - Registry / allowlist id: `mcp:<server>:<tool>` (HTTP API and the tools registry).
 * - Architectural id: `mcp.<server>.<tool>` (see docs/ARCHITECTURE.md).
 * - Model-facing id: `mcp__<server>__<tool>`. OpenAI and Anthropic reject `.` and `:`
 *   (`^[a-zA-Z0-9_-]+$`).
 *
 * Server ids cannot contain `__`, `.`, or `:`, so each form parses unambiguously
 * even when the remote tool name itself contains those characters.
 */

const SERVER_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const PROVIDER_TOOL = /^[a-zA-Z0-9_-]{1,64}$/;

export const PROVIDER_TOOL_NAME_MAX = 64;

export function assertServerId(id: string): void {
  if (!SERVER_ID.test(id) || id.includes("__")) {
    throw new Error(
      `MCP server id "${id}" must match ${SERVER_ID} and must not contain "__" or "."`,
    );
  }
}

export function isServerId(id: string): boolean {
  return SERVER_ID.test(id) && !id.includes("__");
}

/** Id stored in the tools registry and agent allowlists. */
export function registryToolName(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function canonicalToolName(serverId: string, toolName: string): string {
  return `mcp.${serverId}.${toolName}`;
}

export function providerToolName(serverId: string, toolName: string): string {
  const safeTool = PROVIDER_TOOL.test(toolName) ? toolName : sanitizeToolName(toolName);
  return `mcp__${serverId}__${safeTool}`;
}

export function sanitizeToolName(toolName: string): string {
  const cleaned = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+/, "");
  const base = cleaned.length > 0 ? cleaned : "tool";
  return base.slice(0, 48);
}

export interface ParsedToolName {
  serverId: string;
  toolName: string;
  form: "registry" | "canonical" | "provider";
}

/**
 * Accept the registry id (`mcp:<server>:<tool>`), the architectural dotted name,
 * or the provider-safe `__` encoding.
 */
export function parseToolName(name: string): ParsedToolName | null {
  if (name.startsWith("mcp:")) {
    const rest = name.slice(4);
    const colon = rest.indexOf(":");
    if (colon <= 0 || colon === rest.length - 1) return null;
    const serverId = rest.slice(0, colon);
    const toolName = rest.slice(colon + 1);
    if (!isServerId(serverId) || toolName.length === 0 || /\s/.test(toolName)) return null;
    return { serverId, toolName, form: "registry" };
  }
  if (name.startsWith("mcp.")) {
    const rest = name.slice(4);
    const dot = rest.indexOf(".");
    if (dot <= 0 || dot === rest.length - 1) return null;
    const serverId = rest.slice(0, dot);
    const toolName = rest.slice(dot + 1);
    if (!isServerId(serverId) || toolName.length === 0) return null;
    return { serverId, toolName, form: "canonical" };
  }
  if (name.startsWith("mcp__")) {
    const rest = name.slice(5);
    const sep = rest.indexOf("__");
    if (sep <= 0 || sep === rest.length - 2) return null;
    const serverId = rest.slice(0, sep);
    const toolName = rest.slice(sep + 2);
    if (!isServerId(serverId) || toolName.length === 0) return null;
    return { serverId, toolName, form: "provider" };
  }
  return null;
}

export function isMcpToolName(name: string): boolean {
  return parseToolName(name) !== null;
}
