import type { ToolRegistry } from "@botanical/agent-runtime";
import { json } from "../http.ts";
import { authed, type Router } from "../router.ts";

export function registerTools(router: Router, registry: ToolRegistry): void {
  router.add(
    "GET",
    "/api/tools",
    authed(async () => {
      const tools = await registry.list();
      return json(200, { tools });
    }),
  );
}
