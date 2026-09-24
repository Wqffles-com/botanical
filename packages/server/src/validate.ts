import { HttpError } from "./http.ts";
import { AGENT_COLORS, type AgentColor } from "./types.ts";

export const LIMITS = {
  name: 40,
  description: 4_000,
  systemPrompt: 100_000,
  title: 200,
  content: 100_000,
  toolId: 128,
  toolIds: 64,
  id: 200,
} as const;

const ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

export function readAgentIcon(value: unknown): string {
  if (typeof value !== "string" || !ICON_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_body", 'icon must be a Lucide icon name such as "Bot" or "Sprout"');
  }
  return value;
}

export function readAgentColor(value: unknown): AgentColor {
  if (typeof value !== "string" || !(AGENT_COLORS as readonly string[]).includes(value)) {
    throw new HttpError(400, "invalid_body", `color must be one of ${AGENT_COLORS.join(", ")}`);
  }
  return value as AgentColor;
}

/** A public profile id, or null when the caller is clearing the suggestion. */
export function readDefaultProfileId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value.trim())) {
    throw new HttpError(400, "invalid_body", "defaultProfileId must be a profile id or null");
  }
  return value.trim();
}

export function readToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", "toolIds must be an array of strings");
  }
  if (value.length > LIMITS.toolIds) {
    throw new HttpError(400, "invalid_body", `toolIds cannot exceed ${LIMITS.toolIds} entries`);
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
