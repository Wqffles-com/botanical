import {
  createFileTools,
  ToolErrorCode,
  type FileListData,
  type FileReadData,
  type ToolDefinition,
  type ToolResult,
} from "@botanical/tools";

import { HttpError, json } from "../http.ts";
import { authed, type RequestContext, type Router } from "../router.ts";
import { userWorkspaceRoot } from "../runtime/workspace.ts";
import { requireParam } from "../validate.ts";

/**
 * Read-only view of an agent's workspace for the chat sidebar. Uses the same
 * file tools (and path jail) the agent does, so the browser sees exactly what
 * the agent can reach and nothing outside `<user root>/agents/<agentId>`.
 */
export function registerWorkspace(router: Router): void {
  const tools = new Map(createFileTools().map((tool) => [tool.name, tool] as const));
  const list = tools.get("file_list") as ToolDefinition<FileListData>;
  const read = tools.get("file_read") as ToolDefinition<FileReadData>;

  router.add(
    "GET",
    "/api/agents/:id/files",
    authed(async (ctx) => {
      const agentId = await requireAgent(ctx);
      const result = await list.execute(
        { path: readPath(ctx.url, "."), recursive: false, includeHidden: true },
        { workspaceRoot: userWorkspaceRoot(), agentId },
      );
      const data = unwrap(result);
      return json(200, { path: data.path, entries: data.entries, truncated: data.truncated });
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id/files/content",
    authed(async (ctx) => {
      const agentId = await requireAgent(ctx);
      const path = readPath(ctx.url, null);
      if (!path) throw new HttpError(400, "invalid_query", "path is required");
      const result = await read.execute({ path }, { workspaceRoot: userWorkspaceRoot(), agentId });
      const data = unwrap(result);
      return json(200, { path: data.path, content: result.content, bytes: data.bytes });
    }),
  );
}

async function requireAgent(ctx: RequestContext): Promise<string> {
  const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
  if (!agent) throw new HttpError(404, "not_found", "Agent not found");
  return agent.id;
}

function readPath<T extends string | null>(url: URL, fallback: T): string | T {
  const raw = url.searchParams.get("path")?.trim();
  if (!raw) return fallback;
  if (raw.length > 1024) throw new HttpError(400, "invalid_query", "path is too long");
  return raw;
}

function unwrap<T>(result: ToolResult<T>): T {
  if (result.ok && result.data) return result.data;
  const code = result.error?.code ?? ToolErrorCode.toolFailed;
  const message = result.error?.message ?? "workspace read failed";
  if (code === ToolErrorCode.notFound) throw new HttpError(404, "not_found", message);
  if (code === ToolErrorCode.ioError || code === ToolErrorCode.toolFailed || code === ToolErrorCode.invalidWorkspace) {
    throw new HttpError(500, "workspace_error", message);
  }
  throw new HttpError(400, code, message);
}
