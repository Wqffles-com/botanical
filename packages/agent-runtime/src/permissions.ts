/**
 * Capability checks for built-in and MCP tools.
 *
 * Combination rule (2026-09-27): a tool is callable when the agent's allowlist
 * matches it (runtime A2A tools follow `a2aEnabled` instead, and `send_message`
 * is always allowed) AND, when the
 * agent has one or more roles, the union of those roles permits the tool.
 * Agents with no roles keep allowlist-only behavior so existing agents are
 * unchanged. Dispatch must call `toolAccess` even if the tool was omitted
 * from the model payload — models can name tools they were not offered.
 */

import { SEND_MESSAGE_TOOL } from "./replies";
import { parseMcpToolName, toolAllowed } from "./tools";

export const CAPABILITIES = [
  "file.read",
  "file.write",
  "shell",
  "code_exec",
  "web",
  "memory.read",
  "memory.write",
  "agent.create",
  "agent.message",
  "notify",
  "git",
  "github",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface McpGrant {
  /** Server id, or `"*"` for every server. */
  server: string;
  /** Omitted or empty means every tool on that server. `"*"` is the same. */
  tools?: string[];
}

export interface RolePermissions {
  capabilities: Capability[];
  mcp: McpGrant[];
}

export interface AgentRoleGrant {
  id: string;
  name: string;
  permissions: RolePermissions;
}

export interface EffectivePermissions {
  /**
   * True when the agent has no roles. Tools are then gated only by the allowlist.
   * `capabilities` stays empty in that case: there is no role union to report.
   */
  unrestricted: boolean;
  capabilities: Capability[];
  mcp: McpGrant[];
  roleNames: string[];
}

/** Fixed ids shared with the Postgres seed in `packages/db/migrations/0003_mvp2.sql`. */
export const BUILTIN_ROLE_IDS = {
  Coder: "00000000-0000-4000-8000-0000000000c1",
  Reviewer: "00000000-0000-4000-8000-0000000000c2",
  Orchestrator: "00000000-0000-4000-8000-0000000000c3",
} as const;

export interface BuiltinRoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
}

const ALL_CAPABILITIES: Capability[] = [...CAPABILITIES];

export const BUILTIN_ROLES: readonly BuiltinRoleDefinition[] = [
  {
    id: BUILTIN_ROLE_IDS.Coder,
    name: "Coder",
    description:
      "Implements changes. Can read and write files, run shell and code, use git and GitHub, use the web and memory, and message agents. Cannot create agents.",
    permissions: {
      capabilities: [
        "file.read",
        "file.write",
        "shell",
        "code_exec",
        "web",
        "memory.read",
        "memory.write",
        "agent.message",
        "git",
        "github",
      ],
      mcp: [],
    },
  },
  {
    id: BUILTIN_ROLE_IDS.Reviewer,
    name: "Reviewer",
    description: "Reads code, searches the web, and reads memory. Cannot write files, run commands, or create agents.",
    permissions: {
      capabilities: ["file.read", "web", "memory.read"],
      mcp: [],
    },
  },
  {
    id: BUILTIN_ROLE_IDS.Orchestrator,
    name: "Orchestrator",
    description: "Full access, including creating agents, messaging agents, and every MCP server.",
    permissions: {
      capabilities: ALL_CAPABILITIES,
      mcp: [{ server: "*" }],
    },
  },
];

/**
 * Built-in tool id → capability.
 * `agent_list` is `agent.message` (directory of teammates, same gate as sending mail).
 * `file_delete` is a write. There is no separate file-edit tool.
 */
const TOOL_CAPABILITIES: Readonly<Record<string, Capability>> = {
  file_read: "file.read",
  file_list: "file.read",
  file_write: "file.write",
  file_delete: "file.write",
  shell: "shell",
  code_exec: "code_exec",
  web_search: "web",
  web_fetch: "web",
  memory_search: "memory.read",
  memory_list: "memory.read",
  memory_write: "memory.write",
  memory_delete: "memory.write",
  agent_create: "agent.create",
  agent_list: "agent.message",
  send_agent_message: "agent.message",
  agent_send: "agent.message",
  agent_inbox: "agent.message",
  notify_user: "notify",
  git_clone: "git",
  git_init: "git",
  git_status: "git",
  git_diff: "git",
  git_log: "git",
  git_checkout: "git",
  git_commit: "git",
  git_pull: "git",
  git_push: "git",
  github_repo_list: "github",
  github_issue_list: "github",
  github_issue_read: "github",
  github_issue_create: "github",
  github_issue_update: "github",
  github_issue_comment: "github",
  github_pr_list: "github",
  github_pr_read: "github",
  github_pr_create: "github",
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export function capabilityForTool(toolName: string): Capability | null {
  return TOOL_CAPABILITIES[toolName] ?? null;
}

export function effectivePermissions(roles: readonly AgentRoleGrant[] | undefined): EffectivePermissions {
  if (!roles || roles.length === 0) {
    return { unrestricted: true, capabilities: [], mcp: [], roleNames: [] };
  }
  const capabilities = new Set<Capability>();
  const mcp: McpGrant[] = [];
  const roleNames: string[] = [];
  for (const role of roles) {
    roleNames.push(role.name);
    for (const capability of role.permissions.capabilities) {
      if (isCapability(capability)) capabilities.add(capability);
    }
    for (const grant of role.permissions.mcp) mcp.push(grant);
  }
  return {
    unrestricted: false,
    capabilities: CAPABILITIES.filter((capability) => capabilities.has(capability)),
    mcp,
    roleNames,
  };
}

export interface ToolAccessSubject {
  name: string;
  toolAllowlist: readonly string[];
  a2aEnabled: boolean;
  roles?: readonly AgentRoleGrant[];
}

export interface ToolAccessTarget {
  name: string;
  origin: "builtin" | "mcp" | "runtime";
}

export type ToolAccess =
  | { ok: true }
  | { ok: false; kind: "allowlist" | "permission"; message: string };

/**
 * Allowlist (or A2A flag) first, then role capabilities when the agent has roles.
 * No roles → allowlist result stands.
 */
export function toolAccess(agent: ToolAccessSubject, tool: ToolAccessTarget): ToolAccess {
  // Talking to the user is not a capability. Without it the user never hears back.
  if (tool.origin === "runtime" && tool.name === SEND_MESSAGE_TOOL) return { ok: true };
  if (tool.origin === "runtime") {
    if (!agent.a2aEnabled) {
      return { ok: false, kind: "allowlist", message: notAllowed(agent.name, tool.name) };
    }
  } else if (!toolAllowed(agent.toolAllowlist, tool.name)) {
    return { ok: false, kind: "allowlist", message: notAllowed(agent.name, tool.name) };
  }

  const permissions = effectivePermissions(agent.roles);
  if (permissions.unrestricted) return { ok: true };

  const capability = requiredCapability(tool);
  if (!capabilityPermitted(permissions, capability)) {
    return {
      ok: false,
      kind: "permission",
      message: denied(agent.name, capability, permissions.roleNames),
    };
  }
  return { ok: true };
}

export function denied(agentName: string, capability: string, roleNames: readonly string[]): string {
  const roles = roleNames.length > 0 ? roleNames.join(", ") : "none";
  return `permission denied: agent "${agentName}" lacks capability "${capability}" (roles: ${roles})`;
}

function notAllowed(agentName: string, toolName: string): string {
  return `Tool "${toolName}" is not allowed for agent "${agentName}"`;
}

function requiredCapability(tool: ToolAccessTarget): string {
  if (tool.origin === "mcp" || tool.name.startsWith("mcp.")) {
    const parsed = parseMcpToolName(tool.name);
    if (!parsed) return `mcp:${tool.name}`;
    return `mcp:${parsed.serverId}.${parsed.toolName}`;
  }
  return capabilityForTool(tool.name) ?? `tool:${tool.name}`;
}

export function capabilityPermitted(permissions: EffectivePermissions, capability: string): boolean {
  if (permissions.unrestricted) return true;
  if (capability.startsWith("mcp:")) {
    const rest = capability.slice(4);
    const dot = rest.indexOf(".");
    const server = dot === -1 ? rest : rest.slice(0, dot);
    const tool = dot === -1 ? "" : rest.slice(dot + 1);
    return mcpPermitted(permissions.mcp, server, tool);
  }
  return isCapability(capability) && permissions.capabilities.includes(capability);
}

export function mcpPermitted(grants: readonly McpGrant[], server: string, tool: string): boolean {
  for (const grant of grants) {
    if (grant.server !== "*" && grant.server !== server) continue;
    if (!grant.tools || grant.tools.length === 0 || grant.tools.includes("*")) return true;
    if (tool && grant.tools.includes(tool)) return true;
  }
  return false;
}

/**
 * What a no-role agent may grant, derived from its allowlist.
 * `*` implies every capability and every MCP server. Prefix patterns use the
 * same matcher as dispatch (`file_*`, `mcp.docs.*`).
 */
export function impliedPermissions(allowlist: readonly string[], a2aEnabled: boolean): EffectivePermissions {
  const capabilities = new Set<Capability>();
  const mcp: McpGrant[] = [];
  if (a2aEnabled) capabilities.add("agent.message");
  for (const pattern of allowlist) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    if (trimmed === "*") {
      for (const capability of CAPABILITIES) capabilities.add(capability);
      mcp.push({ server: "*" });
      continue;
    }
    if (trimmed.startsWith("mcp.") || trimmed.startsWith("mcp:")) {
      const grant = mcpGrantFromPattern(trimmed);
      if (grant) mcp.push(grant);
      continue;
    }
    for (const [toolName, capability] of Object.entries(TOOL_CAPABILITIES)) {
      if (toolName.startsWith("mcp.")) continue;
      if (toolAllowed([trimmed], toolName)) capabilities.add(capability);
    }
  }
  return {
    unrestricted: false,
    capabilities: CAPABILITIES.filter((capability) => capabilities.has(capability)),
    mcp,
    roleNames: [],
  };
}

function mcpGrantFromPattern(pattern: string): McpGrant | null {
  const body = pattern.startsWith("mcp.") ? pattern.slice(4) : pattern.slice(4);
  if (body === "*" || body === "") return { server: "*" };
  if (body.endsWith(".*")) {
    const server = body.slice(0, -2);
    if (!server || server.includes("*")) return { server: "*" };
    return { server };
  }
  const dot = body.indexOf(".");
  if (dot === -1) return { server: body };
  const server = body.slice(0, dot);
  const tool = body.slice(dot + 1);
  if (!server || !tool || tool.includes("*")) return server ? { server } : null;
  return { server, tools: [tool] };
}

export interface GrantRequest {
  toolIds: readonly string[];
  roles: readonly AgentRoleGrant[];
}

/**
 * Ceiling for tools and roles an agent may hand to an agent it creates.
 * Role-bearing agents use the union of their roles. No-role agents use the
 * capabilities implied by their allowlist. A requested tool must also match
 * the creator's allowlist, so a role cannot smuggle a tool the creator cannot call.
 */
export function grantCeiling(agent: ToolAccessSubject): EffectivePermissions {
  const fromRoles = effectivePermissions(agent.roles);
  if (!fromRoles.unrestricted) return fromRoles;
  return impliedPermissions(agent.toolAllowlist, agent.a2aEnabled);
}

export function escalationError(agent: ToolAccessSubject, requested: GrantRequest): string | null {
  const ceiling = grantCeiling(agent);
  for (const toolId of requested.toolIds) {
    if (!toolAllowed(agent.toolAllowlist, toolId)) {
      return `permission denied: agent "${agent.name}" cannot grant tool "${toolId}" outside its allowlist`;
    }
    const capability = requiredCapability({
      name: toolId,
      origin: toolId.startsWith("mcp.") ? "mcp" : "builtin",
    });
    if (!capabilityPermitted(ceiling, capability)) {
      return denied(agent.name, capability, ceiling.roleNames.length > 0 ? ceiling.roleNames : ["allowlist"]);
    }
  }
  for (const role of requested.roles) {
    for (const capability of role.permissions.capabilities) {
      if (!capabilityPermitted(ceiling, capability)) {
        return `permission denied: agent "${agent.name}" cannot grant role "${role.name}" (capability "${capability}")`;
      }
    }
    for (const grant of role.permissions.mcp) {
      if (!grantCovered(ceiling.mcp, grant)) {
        const label = grant.tools && grant.tools.length > 0 ? `${grant.server}:${grant.tools.join(",")}` : grant.server;
        return `permission denied: agent "${agent.name}" cannot grant role "${role.name}" (mcp "${label}")`;
      }
    }
  }
  return null;
}

function grantCovered(ceiling: readonly McpGrant[], grant: McpGrant): boolean {
  if (grant.server === "*") return ceiling.some((item) => item.server === "*");
  const tools = !grant.tools || grant.tools.length === 0 ? ["*"] : grant.tools;
  return tools.every((tool) => mcpPermitted(ceiling, grant.server, tool === "*" ? "" : tool) || (tool === "*" && mcpPermitted(ceiling, grant.server, "")));
}

export function parseRolePermissions(value: unknown): RolePermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PermissionsError("permissions must be an object with capabilities and mcp");
  }
  const record = value as Record<string, unknown>;
  const rawCaps = record.capabilities ?? [];
  if (!Array.isArray(rawCaps)) throw new PermissionsError("permissions.capabilities must be an array");
  const capabilities: Capability[] = [];
  for (const item of rawCaps) {
    if (typeof item !== "string" || !isCapability(item)) {
      throw new PermissionsError(
        `Unknown capability ${JSON.stringify(item)}. Expected one of ${CAPABILITIES.join(", ")}`,
      );
    }
    if (!capabilities.includes(item)) capabilities.push(item);
  }
  const rawMcp = record.mcp ?? [];
  if (!Array.isArray(rawMcp)) throw new PermissionsError("permissions.mcp must be an array");
  const mcp: McpGrant[] = [];
  for (const item of rawMcp) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PermissionsError("Each mcp grant must be an object");
    }
    const grant = item as Record<string, unknown>;
    if (typeof grant.server !== "string" || grant.server.trim() === "") {
      throw new PermissionsError("mcp grant server is required");
    }
    const server = grant.server.trim();
    if (server.length > 200) throw new PermissionsError("mcp grant server is too long");
    const next: McpGrant = { server };
    if (grant.tools !== undefined) {
      if (!Array.isArray(grant.tools)) throw new PermissionsError("mcp grant tools must be an array of strings");
      const tools: string[] = [];
      for (const tool of grant.tools) {
        if (typeof tool !== "string" || tool.trim() === "" || tool.trim().length > 200) {
          throw new PermissionsError("mcp grant tools must be non-empty strings");
        }
        tools.push(tool.trim());
      }
      if (tools.length > 0) next.tools = tools;
    }
    mcp.push(next);
  }
  return { capabilities, mcp };
}

export class PermissionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionsError";
  }
}
