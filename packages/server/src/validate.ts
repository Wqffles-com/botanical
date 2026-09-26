import {
  AGENT_COLORS,
  AGENT_NAME_MAX,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  isAgentColor,
  isAgentIcon,
  type AgentColor,
} from "@botanical/core";
import { HttpError, isRecord } from "./http.ts";
import type { AgentPatch, NewAgent } from "./types.ts";

export const LIMITS = {
  name: 120,
  agentName: AGENT_NAME_MAX,
  description: 4_000,
  systemPrompt: 100_000,
  title: 200,
  content: 100_000,
  toolId: 128,
  toolIds: 64,
  id: 200,
} as const;

export { DEFAULT_AGENT_COLOR, DEFAULT_AGENT_ICON };

export function readBoundedString(
  value: unknown,
  field: string,
  opts: { required: boolean; max: number; trim?: boolean },
): string | undefined {
  if (value === undefined) {
    if (opts.required) throw new HttpError(400, "invalid_body", `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_body", `${field} must be a string`);
  }
  const text = opts.trim === false ? value : value.trim();
  if (text.length === 0) {
    if (opts.required) throw new HttpError(400, "invalid_body", `${field} is required`);
    return "";
  }
  if (text.length > opts.max) {
    throw new HttpError(400, "invalid_body", `${field} must be at most ${opts.max} characters`);
  }
  return text;
}

export function requireParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name];
  if (!value) throw new HttpError(404, "not_found", "Not found");
  return value;
}

export function readRequiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > LIMITS.id) {
    throw new HttpError(400, "invalid_body", `${field} is required`);
  }
  return value.trim();
}

export function readToolIds(value: unknown, field = "toolIds"): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", `${field} must be an array of strings`);
  }
  if (value.length > LIMITS.toolIds) {
    throw new HttpError(400, "invalid_body", `${field} cannot exceed ${LIMITS.toolIds} entries`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > LIMITS.toolId) {
      throw new HttpError(
        400,
        "invalid_body",
        "Each tool id must be 1-128 characters (letters, numbers, . _ : -)",
      );
    }
    if (!/^[A-Za-z0-9_.:-]+$/.test(item)) {
      throw new HttpError(
        400,
        "invalid_body",
        "Each tool id must be 1-128 characters (letters, numbers, . _ : -)",
      );
    }
    if (seen.has(item)) {
      throw new HttpError(400, "invalid_body", `Duplicate tool id ${JSON.stringify(item)}`);
    }
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

export function readAgentIcon(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_body", "icon must be a Lucide icon name such as Bot or Sprout");
  }
  const icon = value.trim();
  if (!isAgentIcon(icon)) {
    throw new HttpError(400, "invalid_body", "icon must be a Lucide icon name such as Bot or Sprout");
  }
  return icon;
}

export function readAgentColor(value: unknown): AgentColor {
  if (!isAgentColor(value)) {
    throw new HttpError(400, "invalid_body", `color must be one of: ${AGENT_COLORS.join(", ")}`);
  }
  return value;
}

export function readDefaultProfileId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_body", "defaultProfileId must be a string or null");
  }
  const text = value.trim();
  if (text.length === 0 || text.length > LIMITS.id) {
    throw new HttpError(400, "invalid_body", "defaultProfileId must be 1-200 characters or null");
  }
  return text;
}

/** Accepts `prompt` or `systemPrompt`. When both are present they must match. */
export function readAgentPrompt(body: Record<string, unknown>, required: boolean): string | undefined {
  const hasSystem = Object.prototype.hasOwnProperty.call(body, "systemPrompt");
  const hasPrompt = Object.prototype.hasOwnProperty.call(body, "prompt");
  if (!hasSystem && !hasPrompt) {
    if (required) throw new HttpError(400, "invalid_body", "prompt is required");
    return undefined;
  }
  const systemPrompt = hasSystem
    ? readBoundedString(body.systemPrompt, "systemPrompt", { required: true, max: LIMITS.systemPrompt })
    : undefined;
  const prompt = hasPrompt
    ? readBoundedString(body.prompt, "prompt", { required: true, max: LIMITS.systemPrompt })
    : undefined;
  if (systemPrompt !== undefined && prompt !== undefined && systemPrompt !== prompt) {
    throw new HttpError(400, "invalid_body", "prompt and systemPrompt must match");
  }
  const value = systemPrompt ?? prompt;
  if (!value) throw new HttpError(400, "invalid_body", "prompt is required");
  return value;
}

/** Accepts `tools` or `toolIds`. When both are present they must match. */
export function readAgentTools(body: Record<string, unknown>): string[] | undefined {
  const hasIds = Object.prototype.hasOwnProperty.call(body, "toolIds");
  const hasTools = Object.prototype.hasOwnProperty.call(body, "tools");
  if (!hasIds && !hasTools) return undefined;
  const toolIds = hasIds ? readToolIds(body.toolIds, "toolIds") : undefined;
  const tools = hasTools ? readToolIds(body.tools, "tools") : undefined;
  if (
    toolIds &&
    tools &&
    (toolIds.length !== tools.length || toolIds.some((id, index) => id !== tools[index]))
  ) {
    throw new HttpError(400, "invalid_body", "tools and toolIds must match");
  }
  return toolIds ?? tools;
}

export function parseCreateAgent(body: unknown): NewAgent {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.agentName });
  if (!name) throw new HttpError(400, "invalid_body", "name is required");
  const description =
    readBoundedString(body.description, "description", { required: false, max: LIMITS.description }) ?? "";
  const systemPrompt = readAgentPrompt(body, true);
  if (!systemPrompt) throw new HttpError(400, "invalid_body", "prompt is required");
  const icon = Object.prototype.hasOwnProperty.call(body, "icon") ? readAgentIcon(body.icon) : DEFAULT_AGENT_ICON;
  const color = Object.prototype.hasOwnProperty.call(body, "color")
    ? readAgentColor(body.color)
    : DEFAULT_AGENT_COLOR;
  const defaultProfileId = Object.prototype.hasOwnProperty.call(body, "defaultProfileId")
    ? readDefaultProfileId(body.defaultProfileId)
    : null;
  return {
    name,
    icon,
    color,
    description,
    systemPrompt,
    toolIds: readAgentTools(body) ?? [],
    defaultProfileId,
  };
}

export function parseUpdateAgent(body: unknown): AgentPatch {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const patch: AgentPatch = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.agentName });
    if (!name) throw new HttpError(400, "invalid_body", "name is required");
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    patch.description =
      readBoundedString(body.description, "description", { required: false, max: LIMITS.description }) ?? "";
  }
  const systemPrompt = readAgentPrompt(body, false);
  if (systemPrompt !== undefined) patch.systemPrompt = systemPrompt;
  const toolIds = readAgentTools(body);
  if (toolIds !== undefined) patch.toolIds = toolIds;
  if (Object.prototype.hasOwnProperty.call(body, "icon")) patch.icon = readAgentIcon(body.icon);
  if (Object.prototype.hasOwnProperty.call(body, "color")) patch.color = readAgentColor(body.color);
  if (Object.prototype.hasOwnProperty.call(body, "defaultProfileId")) {
    patch.defaultProfileId = readDefaultProfileId(body.defaultProfileId);
  }
  if (
    patch.name === undefined &&
    patch.description === undefined &&
    patch.systemPrompt === undefined &&
    patch.toolIds === undefined &&
    patch.icon === undefined &&
    patch.color === undefined &&
    patch.defaultProfileId === undefined
  ) {
    throw new HttpError(400, "invalid_body", "No fields to update");
  }
  return patch;
}
