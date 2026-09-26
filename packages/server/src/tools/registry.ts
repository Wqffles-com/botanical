import type {
  RegisteredTool,
  RuntimeToolSource,
  ToolCallContext,
  ToolContributor,
  ToolRegistry,
} from "./types.ts";

const EMPTY_PARAMETERS: Record<string, unknown> = { type: "object", properties: {} };

/** Same dispatch rules as m06's `createToolRegistry`: replace by contributor id, first tool id wins. */
export function createToolRegistry(initial: readonly ToolContributor[] = []): ToolRegistry {
  const contributors = new Map<string, ToolContributor>();
  for (const contributor of initial) contributors.set(contributor.id, contributor);

  async function owned(): Promise<Array<{ contributor: ToolContributor; tool: RegisteredTool }>> {
    const seen = new Set<string>();
    const rows: Array<{ contributor: ToolContributor; tool: RegisteredTool }> = [];
    for (const contributor of contributors.values()) {
      const tools = await contributor.listTools();
      for (const tool of tools) {
        const id = tool.id.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({
          contributor,
          tool: {
            ...tool,
            id,
            source: contributor.source,
            parameters: tool.parameters ?? EMPTY_PARAMETERS,
          },
        });
      }
    }
    return rows;
  }

  return {
    register(contributor) {
      contributors.set(contributor.id, contributor);
    },
    unregister(contributorId) {
      return contributors.delete(contributorId);
    },
    getContributor(id) {
      return contributors.get(id);
    },
    async list() {
      return (await owned()).map((row) => row.tool);
    },
    async call(toolId, args, ctx) {
      const match = (await owned()).find((row) => row.tool.id === toolId);
      if (!match) return { content: `Unknown tool "${toolId}"`, isError: true };
      try {
        return await match.contributor.callTool(toolId, args, ctx);
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "Tool failed";
        return { content: message, isError: true };
      }
    },
    toToolSources(enrich) {
      return [...contributors.keys()].map((id) => contributorSource(contributors, id, enrich));
    },
  };
}

function contributorSource(
  contributors: ReadonlyMap<string, ToolContributor>,
  id: string,
  enrich?: (ctx: ToolCallContext) => ToolCallContext,
): RuntimeToolSource {
  return {
    id,
    async listTools() {
      const contributor = contributors.get(id);
      if (!contributor) return [];
      const tools = await contributor.listTools();
      return tools.map((tool) => ({
        name: tool.id,
        description: tool.description,
        parameters: tool.parameters ?? EMPTY_PARAMETERS,
        origin: contributor.source === "mcp" ? ("mcp" as const) : ("builtin" as const),
      }));
    },
    async call(name, args, ctx) {
      const contributor = contributors.get(id);
      if (!contributor) return { output: `Tool source "${id}" is not registered`, isError: true };
      const next = enrich ? enrich({ ...ctx, agentId: ctx.agentId, chatId: ctx.chatId }) : ctx;
      try {
        const result = await contributor.callTool(name, args, next);
        return { output: result.content, isError: result.isError === true };
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "Tool failed";
        return { output: message, isError: true };
      }
    },
  };
}
