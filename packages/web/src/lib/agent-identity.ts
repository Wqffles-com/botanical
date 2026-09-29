import {
  AGENT_TITLE_MAX,
  DEFAULT_AGENT_SHAPE,
  isAgentPicture,
  isAgentShape,
  PLATFORM_TOOLS,
  type AgentShape,
} from "@botanical/core";
import { DEFAULT_AGENT_COLOR, resolveAgentColor, type AgentColor } from "./agent-colors";
import {
  DEFAULT_AGENT_ICON,
  resolveAgentIconName,
  type AgentIconName,
} from "./agent-icons";

export const AGENT_NAME_MAX = 40;
export const AGENT_DESCRIPTION_MAX = 240;
export const AGENT_PROMPT_MAX = 20_000;

export { AGENT_TITLE_MAX };

export type AgentIdentityFields = {
  name: string;
  title: string;
  icon: AgentIconName;
  shape: AgentShape;
  picture: string | null;
  color: AgentColor;
  description: string;
};

export type AgentRoleBadge = {
  id: string;
  name: string;
  builtin: boolean;
};

export type EffectivePermissionsView = {
  unrestricted: boolean;
  capabilities: string[];
  mcp: Array<{ server: string; tools?: string[] }>;
  roleNames: string[];
};

export type AgentIdentity = AgentIdentityFields & {
  id: string;
  prompt: string;
  tools: string[];
  defaultProfileId: string | null;
  createdByAgentId: string | null;
  roleIds: string[];
  roles: AgentRoleBadge[];
  effectivePermissions: EffectivePermissionsView;
  createdAt: string;
  updatedAt: string;
};

export type AgentDraft = {
  name: string;
  title: string;
  description: string;
  prompt: string;
  icon: AgentIconName;
  shape: AgentShape;
  picture: string | null;
  color: AgentColor;
  tools: string[];
  defaultProfileId: string | null;
  roleIds: string[];
};

export type AgentWritePayload = {
  name: string;
  title: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  icon: string;
  shape: AgentShape;
  picture: string | null;
  color: AgentColor;
  tools: string[];
  toolIds: string[];
  defaultProfileId: string | null;
  roleIds: string[];
};

export type ToolInfo = {
  id: string;
  name: string;
  description: string;
  source: string;
};

export type ProfileInfo = {
  id: string;
  name: string;
  provider: string;
  model: string;
  description: string;
  kind: "api" | "cli";
  available: boolean;
  unavailableReason: string | null;
  cli: string | null;
  defaultModel: boolean;
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: "",
  title: "",
  description: "",
  prompt: "",
  icon: DEFAULT_AGENT_ICON,
  shape: DEFAULT_AGENT_SHAPE,
  picture: null,
  color: DEFAULT_AGENT_COLOR,
  tools: [...PLATFORM_TOOLS],
  defaultProfileId: null,
  roleIds: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function readTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        const record = asRecord(item);
        if (!record) return "";
        return readString(record, ["id", "name", "toolId", "tool_id"]);
      })
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

export function identityFromUnknown(value: unknown): AgentIdentity {
  const root = asRecord(value) ?? {};
  const nested = asRecord(root.agent);
  const record = nested ?? root;
  const createdAt = readString(record, ["createdAt", "created_at"]);
  const prompt = readString(record, ["prompt", "systemPrompt", "system_prompt"]);
  const tools = readTools(record.tools ?? record.toolIds ?? record.tool_ids);
  const defaultProfile =
    readString(record, ["defaultProfileId", "default_profile_id", "suggestedProfileId"]) || null;
  const createdBy = readString(record, ["createdByAgentId", "created_by_agent_id"]);
  return {
    id: readString(record, ["id", "uuid"]),
    name: readString(record, ["name"], "Agent"),
    title: readString(record, ["title"]).trim().slice(0, AGENT_TITLE_MAX),
    description: readString(record, ["description"]),
    prompt,
    icon: resolveAgentIconName(record.icon),
    shape: resolveAgentShape(record.shape),
    picture: resolveAgentPicture(record.picture),
    color: resolveAgentColor(record.color),
    tools,
    defaultProfileId: defaultProfile,
    createdByAgentId: createdBy || null,
    roleIds: readStringList(record.roleIds ?? record.role_ids),
    roles: readRoleBadges(record.roles),
    effectivePermissions: readEffective(record.effectivePermissions ?? record.effective_permissions),
    createdAt,
    updatedAt: readString(record, ["updatedAt", "updated_at"], createdAt),
  };
}

export function identitiesFromUnknown(value: unknown): AgentIdentity[] {
  if (Array.isArray(value)) return value.map(identityFromUnknown);
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["agents", "items", "data"]) {
    const list = record[key];
    if (Array.isArray(list)) return list.map(identityFromUnknown);
  }
  return [];
}

export function draftFromIdentity(agent: AgentIdentity): AgentDraft {
  return {
    name: agent.name,
    title: agent.title,
    description: agent.description,
    prompt: agent.prompt,
    icon: agent.icon,
    shape: agent.shape,
    picture: agent.picture,
    color: agent.color,
    tools: [...agent.tools],
    defaultProfileId: agent.defaultProfileId,
    roleIds: [...agent.roleIds],
  };
}

export function validateAgentDraft(draft: AgentDraft): string | null {
  const name = draft.name.trim();
  if (!name) return "Name the agent before saving it.";
  if (name.length > AGENT_NAME_MAX) return `Name must be ${AGENT_NAME_MAX} characters or fewer.`;
  if (draft.title.trim().length > AGENT_TITLE_MAX) {
    return `Title must be ${AGENT_TITLE_MAX} characters or fewer.`;
  }
  if (draft.description.length > AGENT_DESCRIPTION_MAX) {
    return `Description must be ${AGENT_DESCRIPTION_MAX} characters or fewer.`;
  }
  if (draft.picture && !isAgentPicture(draft.picture)) {
    return "Picture must be a PNG, JPEG, or WebP image.";
  }
  if (!draft.prompt.trim()) return "Write a prompt for the agent.";
  if (draft.prompt.length > AGENT_PROMPT_MAX) return "Prompt is too long.";
  return null;
}

export function agentWritePayload(draft: AgentDraft): AgentWritePayload {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const prompt = draft.prompt;
  const tools = [...new Set(draft.tools.map((id) => id.trim()).filter(Boolean))];
  const defaultProfileId = draft.defaultProfileId?.trim() ? draft.defaultProfileId.trim() : null;
  const roleIds = [...new Set(draft.roleIds.map((id) => id.trim()).filter(Boolean))];
  return {
    name,
    title: draft.title.trim(),
    description,
    prompt,
    systemPrompt: prompt,
    icon: resolveAgentIconName(draft.icon),
    shape: resolveAgentShape(draft.shape),
    picture: resolveAgentPicture(draft.picture),
    color: resolveAgentColor(draft.color),
    tools,
    toolIds: tools,
    defaultProfileId,
    roleIds,
  };
}

export function toolsFromUnknown(value: unknown): ToolInfo[] {
  const list = unwrapList(value, ["tools", "items", "data"]);
  return list.map((item, index) => {
    const record = asRecord(item);
    if (!record) {
      const id = typeof item === "string" ? item : `tool-${index}`;
      return { id, name: id, description: "", source: "builtin" };
    }
    const id = readString(record, ["id", "name", "toolId", "tool_id"], `tool-${index}`);
    return {
      id,
      name: readString(record, ["name", "label", "title"], id),
      description: readString(record, ["description", "hint", "summary"]),
      source: readString(record, ["source", "origin", "provider"], "builtin") || "builtin",
    };
  });
}

export function profilesFromUnknown(value: unknown): ProfileInfo[] {
  const list = unwrapList(value, ["profiles", "items", "data"]);
  return list.map((item, index) => {
    const record = asRecord(item) ?? {};
    const id = readString(record, ["id"], `profile-${index}`);
    const provider = readString(record, ["provider", "providerId", "provider_id"]);
    const kind = record.kind === "cli" || provider === "cli" ? "cli" : "api";
    return {
      id,
      name: readString(record, ["name", "label"], id),
      provider,
      model: readString(record, ["model", "modelId", "model_id"]),
      description: readString(record, ["description"]) || "",
      kind,
      available: record.available !== false,
      unavailableReason:
        typeof record.unavailableReason === "string" && record.unavailableReason.trim()
          ? record.unavailableReason
          : null,
      cli: typeof record.cli === "string" && record.cli.trim() ? record.cli : null,
      defaultModel: record.defaultModel === true,
    };
  });
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readRoleBadges(value: unknown): AgentRoleBadge[] {
  if (!Array.isArray(value)) return [];
  const roles: AgentRoleBadge[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const id = readString(record, ["id"]);
    const name = readString(record, ["name"]);
    if (!id && !name) continue;
    roles.push({ id: id || name, name: name || id, builtin: record.builtin === true });
  }
  return roles;
}

function readEffective(value: unknown): EffectivePermissionsView {
  const record = asRecord(value);
  if (!record) return { unrestricted: true, capabilities: [], mcp: [], roleNames: [] };
  const capabilities = readStringList(record.capabilities);
  const roleNames = readStringList(record.roleNames ?? record.role_names);
  const mcp: EffectivePermissionsView["mcp"] = [];
  if (Array.isArray(record.mcp)) {
    for (const item of record.mcp) {
      const grant = asRecord(item);
      if (!grant) continue;
      const server = readString(grant, ["server"]);
      if (!server) continue;
      const tools = readStringList(grant.tools);
      mcp.push(tools.length > 0 ? { server, tools } : { server });
    }
  }
  return {
    unrestricted: record.unrestricted !== false && roleNames.length === 0 && capabilities.length === 0,
    capabilities,
    mcp,
    roleNames,
  };
}

function unwrapList(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const list = record[key];
    if (Array.isArray(list)) return list;
  }
  return [];
}

export function agentIdentity(agent: IdentityLoose | null | undefined): AgentIdentityFields {
  return {
    name: agent?.name?.trim() || "Agent",
    title: agent?.title?.trim().slice(0, AGENT_TITLE_MAX) ?? "",
    icon: resolveAgentIconName(agent?.icon),
    shape: resolveAgentShape(agent?.shape),
    picture: resolveAgentPicture(agent?.picture),
    color: resolveAgentColor(agent?.color),
    description: agent?.description?.trim() ?? "",
  };
}

export function resolveAgentShape(value: unknown): AgentShape {
  return isAgentShape(value) ? value : DEFAULT_AGENT_SHAPE;
}

export function resolveAgentPicture(value: unknown): string | null {
  return isAgentPicture(value) ? value : null;
}

type IdentityLoose = {
  name?: string | null;
  title?: string | null;
  icon?: string | null;
  shape?: string | null;
  picture?: string | null;
  color?: string | null;
  description?: string | null;
};

export function filterAgents(agents: AgentIdentity[], query: string): AgentIdentity[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return agents;
  return agents.filter((agent) => {
    return (
      agent.name.toLowerCase().includes(needle) ||
      agent.title.toLowerCase().includes(needle) ||
      agent.description.toLowerCase().includes(needle) ||
      agent.icon.toLowerCase().includes(needle) ||
      agent.color.toLowerCase().includes(needle)
    );
  });
}
