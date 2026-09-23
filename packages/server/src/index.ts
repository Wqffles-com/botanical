import { resolveDeploymentMode, type HealthResponse } from "@botanical/core";
import { DATABASE_URL_ENV } from "@botanical/db";
import { PROVIDER_IDS } from "@botanical/providers";
import { BUILTIN_TOOL_NAMES } from "@botanical/tools";

// Postgres is not opened here. DATABASE_URL is reserved for a later slice.
const port = Number(process.env.PORT ?? 8787);
const mode = resolveDeploymentMode(process.env.BOTANICAL_MODE);

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/health") {
      const body: HealthResponse = {
        ok: true,
        service: "botanical",
        mode,
      };
      return Response.json(body);
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(
  `botanical server listening on http://${server.hostname}:${server.port} mode=${mode} ${DATABASE_URL_ENV} providers=${PROVIDER_IDS.length} tools=${BUILTIN_TOOL_NAMES.length}`,
);
