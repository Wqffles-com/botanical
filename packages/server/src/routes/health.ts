import { json } from "../http.ts";
import type { Router } from "../router.ts";

export function registerHealth(router: Router): void {
  router.add("GET", "/api/health", (ctx) => {
    return json(200, {
      ok: true,
      service: "botanical-server",
      version: ctx.config.version,
      deploymentMode: ctx.config.deploymentMode,
      brand: { name: ctx.config.brandName },
      persistence: ctx.store.kind,
    });
  });

  router.add("GET", "/", (ctx) => {
    return json(200, {
      service: "botanical-server",
      version: ctx.config.version,
      deploymentMode: ctx.config.deploymentMode,
      brand: { name: ctx.config.brandName },
      health: "/api/health",
    });
  });
}
