import type { ExecutableTool, ToolCallContext, ToolResult } from "@botanical/agent-runtime";

/**
 * Adapts a built-in from packages/tools into the runtime's ExecutableTool.
 * Accepts `parameters`, `inputSchema`, or `jsonSchema`, and either a ToolResult
 * or a raw return value.
 */
export function adaptTool(tool: {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  jsonSchema?: Record<string, unknown>;
  execute: (args: unknown, ctx?: ToolCallContext) => Promise<unknown> | unknown;
}): ExecutableTool {
  const parameters = tool.parameters ?? tool.inputSchema ?? tool.jsonSchema ?? {
    type: "object",
    properties: {},
  };
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    async execute(args, ctx) {
      const raw = await tool.execute(args, ctx);
      if (isToolResult(raw)) return raw;
      return { output: raw ?? "" };
    },
  };
}

function isToolResult(value: unknown): value is ToolResult {
  return value != null && typeof value === "object" && "output" in value;
}
