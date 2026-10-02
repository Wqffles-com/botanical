import { isAgentShape } from "@botanical/core";
import { AGENT_COLORS, resolveAgentColor } from "./agent-colors";
import { resolveAgentIconName } from "./agent-icons";
import {
  AGENT_DESCRIPTION_MAX,
  AGENT_NAME_MAX,
  AGENT_PROMPT_MAX,
  AGENT_TITLE_MAX,
  EMPTY_AGENT_DRAFT,
  resolveAgentShape,
  type AgentDraft,
  type ProfileInfo,
} from "./agent-identity";

export const AGENT_EXPORT_FORMAT = "botanical-agent";

export type AgentExport = {
  format: typeof AGENT_EXPORT_FORMAT;
  version: 1;
  name: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  shape: string;
  prompt: string;
  tools: string[];
  /** The default model by name, since profile ids differ between instances. Null when none. */
  defaultModel: { provider: string; model: string } | null;
};

/** Portable agent definition: no ids, roles, picture, or secrets. */
export function agentToExport(agent: AgentDraft, profiles: ProfileInfo[]): AgentExport {
  const profile = profiles.find((item) => item.id === agent.defaultProfileId);
  return {
    format: AGENT_EXPORT_FORMAT,
    version: 1,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    icon: agent.icon,
    color: agent.color,
    shape: agent.shape,
    prompt: agent.prompt,
    tools: [...agent.tools],
    defaultModel: profile ? { provider: profile.provider, model: profile.model } : null,
  };
}

export type AgentImport = { draft: AgentDraft; notes: string[] };

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Reads an exported agent into a form draft. Throws a readable message when the file is not an
 * agent. Unknown tools and models are dropped and reported in `notes`.
 */
export function parseAgentImport(source: string, profiles: ProfileInfo[], knownTools: string[]): AgentImport {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("That file is not an agent.");
  const record = root as Record<string, unknown>;
  if (record.format !== AGENT_EXPORT_FORMAT) throw new Error("That file is not a Botanical agent export.");
  if (typeof record.name !== "string" || !record.name.trim()) throw new Error("The agent in that file has no name.");
  if (typeof record.prompt !== "string" || !record.prompt.trim()) throw new Error("The agent in that file has no prompt.");

  const notes: string[] = [];
  const known = new Set(knownTools);
  const requested = Array.isArray(record.tools)
    ? record.tools.filter((item): item is string => typeof item === "string")
    : [];
  const tools = known.size ? requested.filter((id) => known.has(id)) : requested;
  const dropped = requested.filter((id) => !tools.includes(id));
  if (dropped.length) notes.push(`Skipped tools this server does not have: ${dropped.join(", ")}.`);

  let defaultProfileId: string | null = null;
  const model = record.defaultModel;
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const { provider, model: name } = model as Record<string, unknown>;
    const match = profiles.find((item) => item.provider === provider && item.model === name && item.available);
    if (match) defaultProfileId = match.id;
    else notes.push(`Default model ${String(name)} is not available here. Pick one.`);
  }

  const color = typeof record.color === "string" && (AGENT_COLORS as readonly string[]).includes(record.color)
    ? resolveAgentColor(record.color)
    : EMPTY_AGENT_DRAFT.color;
  return {
    draft: {
      ...EMPTY_AGENT_DRAFT,
      name: record.name.trim().slice(0, AGENT_NAME_MAX),
      title: text(record.title, AGENT_TITLE_MAX).trim(),
      description: text(record.description, AGENT_DESCRIPTION_MAX),
      prompt: record.prompt.slice(0, AGENT_PROMPT_MAX),
      icon: resolveAgentIconName(record.icon),
      color,
      shape: isAgentShape(record.shape) ? resolveAgentShape(record.shape) : EMPTY_AGENT_DRAFT.shape,
      tools,
      defaultProfileId,
    },
    notes,
  };
}
