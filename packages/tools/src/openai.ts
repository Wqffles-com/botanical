import type { OpenAIFunctionTool, ToolDefinition } from "./types.ts";

/** OpenAI Chat Completions / Responses function tool shape. */
export function toOpenAIFunctionTool(tool: ToolDefinition): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
