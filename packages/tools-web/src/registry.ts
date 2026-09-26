import { failureFromUnknown, toolError } from "./result.ts";
import { toToolDefinition, type Tool, type ToolContext, type ToolDefinition, type ToolExecutionResult } from "./types.ts";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: readonly Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  definitions(): ToolDefinition[] {
    return this.list().map(toToolDefinition);
  }

  async execute(name: string, args: unknown, ctx?: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return toolError("unknown_tool", `No tool named "${name}" is registered.`);
    }
    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      return failureFromUnknown(error);
    }
  }
}
