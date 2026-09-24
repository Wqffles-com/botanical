import { json } from "../http.ts";
import type { ToolRegistry } from "../tools/types.ts";
import { authed, type Router } from "../router.ts";

/** `GET /api/tools` — built-ins and any MCP tools registered beside them. */
export function registerTools(router: Router, registry: ToolRegistry): void {
  router.add(
    "GET",
    "/api/tools",
    authed(async () => {
      return json(200, { tools: await registry.list() });
    }),
  );
}
