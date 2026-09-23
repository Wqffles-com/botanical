/**
 * Built-in tool contract shared by shell, code exec, web, and file tools.
 *
 * The agent loop should:
 * 1. Send {@link toModelTool} definitions to the provider.
 * 2. Honor {@link ToolDefinition.approval} before calling `execute`.
 * 3. Feed {@link ToolResult.content} back to the model. Treat `data` as
 *    runtime metadata; `data.operatorDiagnostic` can contain host paths.
 */

export const APPROVAL_LEVELS = ["allow", "ask", "deny"] as const;

export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

/** JSON Schema fragment. Kept structural so it serializes to providers as-is. */
export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface JsonObjectSchema extends JsonSchema {
  type: "object";
  properties: Readonly<Record<string, JsonSchema>>;
  additionalProperties: false;
}

/**
 * Per-call context from the agent runtime.
 * Workspace-scoped tools require `workspaceRoot` to be an existing directory.
 */
export interface ToolContext {
  /** Absolute host path this call is confined to. */
  workspaceRoot: string;
  /** Cancels the underlying process. */
  signal?: AbortSignal;
  /** Correlation ids for audit. Never forwarded into a sandbox. */
  meta?: Readonly<Record<string, string>>;
}

export interface ToolResult {
  /** False when the call did not finish cleanly (bad args, non-zero exit, timeout, jail failure). */
  ok: boolean;
  /** Text the model should see. */
  content: string;
  /** Structured payload for the runtime and UI. */
  data?: unknown;
  /** Set when stdout/stderr hit the output cap. */
  truncated?: boolean;
  /** Short failure reason. Absent on success. */
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object (OpenAI `parameters` / Anthropic `input_schema`). */
  parameters: JsonObjectSchema;
  /**
   * Policy hint. Shell and code exec are `"ask"`.
   * `execute` does not prompt; the server must gate the call.
   */
  approval: ApprovalLevel;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** Provider-facing slice. Strips `execute` and the approval hint. */
export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
}

export function toModelTool(tool: ToolDefinition): ModelToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
