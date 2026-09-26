/**
 * Tool contract shared by built-in tools.
 *
 * `parameters` is a JSON Schema object describing the arguments object the
 * model must send. Adapters can pass {@link toToolDefinition} through without
 * the `execute` function.
 */
export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: string | number | boolean | null;
}

export interface JsonSchema {
  type: "object";
  properties: Readonly<Record<string, JsonSchemaProperty>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  description?: string;
}

/** Resolves a hostname to IP addresses. `web_fetch` uses this before connecting. */
export type DnsLookup = (hostname: string) => Promise<readonly string[]>;

/** `fetch` call signature. Narrower than Bun's `typeof fetch`, which also has `preconnect`. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Per-call context. Production callers can omit every field.
 * Tests inject `env`, `fetch`, and `dnsLookup` so tools stay offline.
 */
export interface ToolContext {
  signal?: AbortSignal;
  /** When set, replaces `process.env` for this call. An empty object hides the real environment. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  dnsLookup?: DnsLookup;
}

export interface ToolExecutionResult {
  /** Text the model should see. Markdown when the tool produced prose. */
  content: string;
  /** False when the tool did not complete the requested work. */
  ok: boolean;
  /** Structured payload for audit or UI. Adapters should send `content` to the model. */
  data?: unknown;
  /** Set when `ok` is false. */
  errorCode?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args: unknown, ctx?: ToolContext): Promise<ToolExecutionResult>;
}

export function toToolDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export function isTool(value: unknown): value is Tool {
  if (!value || typeof value !== "object") return false;
  const tool = value as Partial<Tool>;
  return typeof tool.name === "string"
    && tool.name.length > 0
    && typeof tool.description === "string"
    && tool.description.length > 0
    && typeof tool.execute === "function"
    && isObjectSchema(tool.parameters);
}

function isObjectSchema(value: unknown): value is JsonSchema {
  if (!value || typeof value !== "object") return false;
  const schema = value as Partial<JsonSchema>;
  return schema.type === "object" && typeof schema.properties === "object" && schema.properties !== null;
}
