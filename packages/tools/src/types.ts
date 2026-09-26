import type { ToolErrorCode } from "./errors.ts";

/**
 * Shared built-in tool contract (v1).
 *
 * Web, shell, file, and MCP adapters should all expose this shape so the
 * agent runtime can list and execute them without per-tool branches.
 * `parameters` is a JSON Schema object, matching OpenAI function `parameters`
 * and MCP `inputSchema`.
 */
export const TOOL_INTERFACE_VERSION = 1;

export type ToolRisk = "read" | "write" | "destructive" | "network" | "execute";

export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  enum?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  default?: string | number | boolean;
}

export interface JsonSchemaObject extends JsonSchema {
  type: "object";
  properties: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface ToolContext {
  /**
   * Jail root for this call. Overrides the root captured when the tool was
   * constructed. Self-host deploys usually set one root; a hosted deploy can
   * pass a different directory per tenant. Tools must not assume a single
   * global workspace.
   */
  workspaceRoot?: string;
  signal?: AbortSignal;
  /** Hint for tools that run subprocesses. File tools do not use it. */
  timeoutMs?: number;
  agentId?: string;
  chatId?: string;
  deploymentMode?: "self_host" | "saas";
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolErrorBody {
  code: ToolErrorCode | (string & {});
  message: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  /** Text returned to the model. */
  content: string;
  /** Structured payload for the runtime or UI. */
  data?: T;
  error?: ToolErrorBody;
}

export interface ToolDefinition<TData = unknown> {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  risk: ToolRisk;
  /**
   * The runtime should ask the operator before executing.
   * The tool still enforces its own safety checks if the runtime forgets.
   */
  requiresApproval: boolean;
  execute(params: unknown, ctx?: ToolContext): Promise<ToolResult<TData>>;
}

export interface OpenAIFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface ToolRegistry {
  list(): readonly ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  toOpenAITools(): OpenAIFunctionTool[];
  execute(name: string, params: unknown, ctx?: ToolContext): Promise<ToolResult>;
}
