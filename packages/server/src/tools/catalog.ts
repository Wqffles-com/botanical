import {
  TOOL_CONTRIBUTOR_EXPORT,
  contributorFromBuiltins,
  createToolRegistry,
  type ToolContributor,
  type ToolContributorFactory,
  type ToolRegistry,
} from "@botanical/agent-runtime";
import { createFileTools } from "@botanical/tools";

/** Packages m08 and m09 export `createToolContributor` from. */
export const TOOL_CONTRIBUTOR_PACKAGES = [
  "@botanical/tools-shell",
  "@botanical/tools-web",
  "@botanical/mcp",
] as const;

export function createFileToolsContributor(): ToolContributor {
  return contributorFromBuiltins(
    createFileTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.parameters },
      execute: (args: unknown, ctx?: { workspaceRoot?: string; signal?: AbortSignal; agentId?: string; chatId?: string }) =>
        tool.execute(args, ctx),
    })),
    { id: "builtin.files" },
  );
}

export function createDefaultToolRegistry(): ToolRegistry {
  return createToolRegistry([createFileToolsContributor()]);
}

/**
 * Load optional contributors. A package that does not export
 * `createToolContributor` yet is skipped. Import failures are logged and ignored
 * so the file-tool demo still runs.
 */
export async function registerPackageContributors(registry: ToolRegistry): Promise<string[]> {
  const ids: string[] = [];
  for (const spec of TOOL_CONTRIBUTOR_PACKAGES) {
    const contributor = await loadContributor(spec);
    if (!contributor) continue;
    registry.register(contributor);
    ids.push(contributor.id);
  }
  return ids;
}

async function loadContributor(spec: string): Promise<ToolContributor | null> {
  try {
    const loaded = (await import(spec)) as Record<string, unknown>;
    const factory = loaded[TOOL_CONTRIBUTOR_EXPORT];
    if (typeof factory !== "function") return null;
    const contributor = await (factory as ToolContributorFactory)();
    if (!isContributor(contributor)) {
      console.error(`[botanical] ${spec} ${TOOL_CONTRIBUTOR_EXPORT} did not return a tool contributor`);
      return null;
    }
    return contributor;
  } catch (error) {
    const message = error instanceof Error ? error.message : "import failed";
    console.error(`[botanical] skipped tool package ${spec}: ${message}`);
    return null;
  }
}

function isContributor(value: unknown): value is ToolContributor {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ToolContributor>;
  return (
    typeof record.id === "string" &&
    (record.source === "builtin" || record.source === "mcp") &&
    typeof record.listTools === "function" &&
    typeof record.callTool === "function"
  );
}
