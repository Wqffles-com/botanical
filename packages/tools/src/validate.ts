import { ToolError, ToolErrorCode } from "./errors.ts";
import type { JsonSchema, JsonSchemaObject } from "./types.ts";

/** Accept an object or a JSON object string (OpenAI tool-call arguments). */
export function coerceParams(params: unknown): unknown {
  if (typeof params !== "string") return params;
  const trimmed = params.trim();
  if (trimmed.length === 0) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new ToolError(
      ToolErrorCode.invalidParams,
      "parameters must be an object or a JSON object string",
    );
  }
}

export function parseParams(
  schema: JsonSchemaObject,
  params: unknown,
): Record<string, unknown> {
  const coerced = coerceParams(params);
  if (coerced == null) {
    if ((schema.required ?? []).length === 0) return applyDefaults(schema, {});
    throw new ToolError(ToolErrorCode.invalidParams, "parameters must be an object");
  }
  if (typeof coerced !== "object" || Array.isArray(coerced)) {
    throw new ToolError(ToolErrorCode.invalidParams, "parameters must be an object");
  }

  const obj = coerced as Record<string, unknown>;
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        throw new ToolError(ToolErrorCode.invalidParams, `unknown parameter: ${key}`);
      }
    }
  }

  for (const key of schema.required ?? []) {
    const value = obj[key];
    if (value === undefined || value === null) {
      throw new ToolError(ToolErrorCode.invalidParams, `missing required parameter: ${key}`);
    }
  }

  return applyDefaults(schema, obj);
}

function applyDefaults(
  schema: JsonSchemaObject,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = obj[key];
    if (value === undefined) {
      if (prop.default !== undefined) out[key] = prop.default;
      continue;
    }
    out[key] = checkSchema(key, prop, value);
  }
  return out;
}

function checkSchema(key: string, schema: JsonSchema, value: unknown): unknown {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        throw new ToolError(ToolErrorCode.invalidParams, `${key} must be a string`);
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new ToolError(
          ToolErrorCode.invalidParams,
          `${key} must be at least ${schema.minLength} characters`,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new ToolError(
          ToolErrorCode.invalidParams,
          `${key} must be at most ${schema.maxLength} characters`,
        );
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new ToolError(ToolErrorCode.invalidParams, `${key} must be an integer`);
      }
      checkRange(key, schema, value);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ToolError(ToolErrorCode.invalidParams, `${key} must be a finite number`);
      }
      checkRange(key, schema, value);
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ToolError(ToolErrorCode.invalidParams, `${key} must be a boolean`);
      }
      break;
    default:
      throw new ToolError(ToolErrorCode.invalidParams, `${key} has an unsupported schema type`);
  }

  if (schema.enum !== undefined && !schema.enum.some((item) => item === value)) {
    throw new ToolError(
      ToolErrorCode.invalidParams,
      `${key} must be one of: ${schema.enum.join(", ")}`,
    );
  }
  return value;
}

function checkRange(key: string, schema: JsonSchema, value: number): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new ToolError(ToolErrorCode.invalidParams, `${key} must be >= ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new ToolError(ToolErrorCode.invalidParams, `${key} must be <= ${schema.maximum}`);
  }
}

export function asString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new ToolError(ToolErrorCode.invalidParams, `${key} must be a string`);
  }
  return value;
}

export function asBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new ToolError(ToolErrorCode.invalidParams, `${key} must be a boolean`);
  }
  return value;
}

export function asInteger(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolError(ToolErrorCode.invalidParams, `${key} must be an integer`);
  }
  return value;
}
