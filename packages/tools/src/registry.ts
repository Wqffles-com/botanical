import { ToolError, ToolErrorCode } from "./errors.ts";
import { toOpenAIFunctionTool } from "./openai.ts";
import type {
  JsonSchemaObject,
  ToolContext,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
  ToolRisk,
} from "./types.ts";
import { parseParams } from "./validate.ts";

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function errorResult(err: unknown): ToolResult {
  if (err instanceof ToolError) {
    return {
      ok: false,
      content: err.message,
      error: { code: err.code, message: err.message },
    };
  }
  return {
    ok: false,
    content: "tool failed",
    error: { code: ToolErrorCode.toolFailed, message: "tool failed" },
  };
}

export interface DefineToolInput<TData> {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  risk: ToolRisk;
  requiresApproval: boolean;
  run(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult<TData>>;
}

/**
 * Validate the tool name and parameters, then guarantee `execute` returns a
 * {@link ToolResult} instead of throwing.
 */
export function defineTool<TData>(input: DefineToolInput<TData>): ToolDefinition<TData> {
  if (!TOOL_NAME.test(input.name)) {
    throw new ToolError(
      ToolErrorCode.invalidParams,
      `invalid tool name: ${input.name}`,
    );
  }
  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    risk: input.risk,
    requiresApproval: input.requiresApproval,
    async execute(params, ctx): Promise<ToolResult<TData>> {
      try {
        if (ctx?.signal?.aborted) {
          throw new ToolError(ToolErrorCode.aborted, "operation aborted");
        }
        const parsed = parseParams(input.parameters, params);
        return await input.run(parsed, ctx ?? {});
      } catch (err) {
        return errorResult(err) as ToolResult<TData>;
      }
    },
  };
}

export function createToolRegistry(tools: readonly ToolDefinition[]): ToolRegistry {
  const map = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`duplicate tool: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }
  const list = [...map.values()];

  return {
    list: () => list,
    get: (name) => map.get(name),
    toOpenAITools: () => list.map((tool) => toOpenAIFunctionTool(tool)),
    async execute(name, params, ctx) {
      const tool = map.get(name);
      if (!tool) {
        return {
          ok: false,
          content: `unknown tool: ${name}`,
          error: { code: ToolErrorCode.unknownTool, message: `unknown tool: ${name}` },
        };
      }
      return tool.execute(params, ctx);
    },
  };
}
