import { ToolCallError } from "./result.ts";

export function parseArgsObject(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new ToolCallError("invalid_arguments", "Tool arguments must be a JSON object.");
    }
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new ToolCallError("invalid_arguments", "Tool arguments were not valid JSON.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolCallError("invalid_arguments", "Tool arguments must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requireString(args: Record<string, unknown>, key: string, maxLength: number): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new ToolCallError("invalid_arguments", `${key} is required and must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolCallError("invalid_arguments", `${key} is required and must be a non-empty string.`);
  }
  if (trimmed.length > maxLength) {
    throw new ToolCallError("invalid_arguments", `${key} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

export function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  throw new ToolCallError("invalid_arguments", `${key} must be an integer.`);
}

export function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  throw new ToolCallError("invalid_arguments", `${key} must be one of: ${allowed.join(", ")}.`);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
