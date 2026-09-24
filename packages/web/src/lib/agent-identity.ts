import { DEFAULT_AGENT_COLOR, resolveAgentColor, type AgentColor } from "./agent-colors";
import {
  DEFAULT_AGENT_ICON,
  resolveAgentIconName,
  type AgentIconName,
} from "./agent-icons";

export const AGENT_NAME_MAX = 40;
export const AGENT_DESCRIPTION_MAX = 240;
export const AGENT_PROMPT_MAX = 20_000;

export type AgentIdentityFields = {
  name: string;
  icon: AgentIconName;
  color: AgentColor;
  description: string;
};

export type AgentIdentity = AgentIdentityFields & {
  id: string;
  prompt: string;
  tools: string[];
  defaultProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentDraft = {
  name: string;
  description: string;
  prompt: string;
  icon: AgentIconName;
  color: AgentColor;
  tools: string[];
  defaultProfileId: string | null;
};

export type AgentWritePayload = {
  name: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  icon: string;
  color: AgentColor;
  tools: string[];
  toolIds: string[];
  defaultProfileId: string | null;
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
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: "",
  description: "",
  prompt: "",
  icon: DEFAULT_AGENT_ICON,
  color: DEFAULT_AGENT_COLOR,
  tools: [],
  defaultProfileId: null,
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
  return {
    id: readString(record, ["id", "uuid"]),
    name: readString(record, ["name"], "Agent"),
    description: readString(record, ["description"]),
    prompt,
    icon: resolveAgentIconName(record.icon),
    color: resolveAgentColor(record.color),
    tools,
    defaultProfileId: defaultProfile,
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
    description: agent.description,
    prompt: agent.prompt,
    icon: agent.icon,
    color: agent.color,
    tools: [...agent.tools],
    defaultProfileId: agent.defaultProfileId,
  };
}

export function validateAgentDraft(draft: AgentDraft): string | null {
  const name = draft.name.trim();
  if (!name) return "Name the agent before saving it.";
  if (name.length > AGENT_NAME_MAX) return `Name must be ${AGENT_NAME_MAX} characters or fewer.`;
  if (draft.description.length > AGENT_DESCRIPTION_MAX) {
    return `Description must be ${AGENT_DESCRIPTION_MAX} characters or fewer.`;
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
  return {
    name,
    description,
    prompt,
    systemPrompt: prompt,
    icon: resolveAgentIconName(draft.icon),
    color: resolveAgentColor(draft.color),
    tools,
    toolIds: tools,
    defaultProfileId,
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
    return {
      id,
      name: readString(record, ["name", "label"], id),
      provider: readString(record, ["provider", "providerId", "provider_id"]),
      model: readString(record, ["model", "modelId", "model_id"]),
      description: readString(record, ["description"]) || "",
    };
  });
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
    icon: resolveAgentIconName(agent?.icon),
    color: resolveAgentColor(agent?.color),
    description: agent?.description?.trim() ?? "",
  };
}

type IdentityLoose = {
  name?: string | null;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
};

export function filterAgents(agents: AgentIdentity[], query: string): AgentIdentity[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return agents;
  return agents.filter((agent) => {
    return (
      agent.name.toLowerCase().includes(needle) ||
      agent.description.toLowerCase().includes(needle) ||
      agent.icon.toLowerCase().includes(needle) ||
      agent.color.toLowerCase().includes(needle)
    );
  });
}
