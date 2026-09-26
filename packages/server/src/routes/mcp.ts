import { json } from "../http.ts";
import { authed, type Router } from "../router.ts";

export function registerMcp(router: Router): void {
  router.add(
    "GET",
    "/api/mcp/servers",
    authed((ctx) => json(200, ctx.mcp.snapshot())),
  );
}
