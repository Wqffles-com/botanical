import type { EffectivePermissions, RolePermissions, RoleRecord } from "@botanical/core";

export const CAPABILITY_OPTIONS = [
  { id: "file.read", label: "Read files" },
  { id: "file.write", label: "Write files" },
  { id: "shell", label: "Shell" },
  { id: "code_exec", label: "Run code" },
  { id: "web", label: "Web" },
  { id: "memory.read", label: "Read memory" },
  { id: "memory.write", label: "Write memory" },
  { id: "agent.create", label: "Create agents" },
  { id: "agent.message", label: "Message agents" },
] as const;

export type CapabilityId = (typeof CAPABILITY_OPTIONS)[number]["id"];

const CAPABILITY_IDS = new Set<string>(CAPABILITY_OPTIONS.map((item) => item.id));

export function capabilityLabel(id: string): string {
  return CAPABILITY_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

export function orderCapabilities(ids: Iterable<string>): string[] {
  const selected = new Set(ids);
  const known = CAPABILITY_OPTIONS.filter((item) => selected.has(item.id)).map((item) => item.id);
  const extra = [...selected].filter((id) => !CAPABILITY_IDS.has(id));
  return [...known, ...extra];
}

export function emptyPermissions(): RolePermissions {
  return { capabilities: [], mcp: [] };
}

export function previewEffective(roleIds: string[], roles: RoleRecord[]): EffectivePermissions {
  const selected = roles.filter((role) => roleIds.includes(role.id));
  if (selected.length === 0) {
    return { unrestricted: true, capabilities: [], mcp: [], roleNames: [] };
  }
  const capabilities = new Set<string>();
  const mcp: RolePermissions["mcp"] = [];
  for (const role of selected) {
    for (const capability of role.permissions.capabilities) capabilities.add(capability);
    mcp.push(...role.permissions.mcp);
  }
  return {
    unrestricted: false,
    capabilities: orderCapabilities(capabilities),
    mcp,
    roleNames: selected.map((role) => role.name),
  };
}

export function parseTagList(value: string): string[] {
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

export function formatMcpGrant(grant: { server: string; tools?: string[] }): string {
  if (!grant.tools || grant.tools.length === 0) return grant.server;
  return `${grant.server} (${grant.tools.join(", ")})`;
}
