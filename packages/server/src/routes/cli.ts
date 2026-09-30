import { isCliName, LoginBusyError } from "@botanical/providers";

import { HttpError, isRecord, json, readJson } from "../http.ts";
import { authed, type RequestContext, type Router } from "../router.ts";
import type { CliService } from "../cli-install/service.ts";

export function registerCli(router: Router, service: CliService): void {
  router.add(
    "GET",
    "/api/cli",
    authed(async (ctx) => json(200, { clis: await service.list(ctx.user?.id ?? "") })),
  );

  router.add(
    "POST",
    "/api/cli/:cli/install",
    authed(async (ctx) => {
      const cli = requireKnown(ctx);
      const update = await wantsUpdate(ctx);
      const row = await service.install(cli, update, ctx.user?.id ?? "");
      return json(200, { cli: row });
    }),
  );

  router.add(
    "POST",
    "/api/cli/:cli/login",
    authed((ctx) => {
      const cli = requireKnown(ctx);
      try {
        return json(200, { login: service.loginStart(cli, ctx.user?.id ?? "") });
      } catch (error) {
        if (error instanceof LoginBusyError) throw new HttpError(409, "login_in_progress", error.message);
        throw error;
      }
    }),
  );

  router.add(
    "GET",
    "/api/cli/:cli/login",
    authed((ctx) => {
      const cli = requireKnown(ctx);
      return json(200, { login: service.loginGet(cli, ctx.user?.id ?? "") });
    }),
  );

  router.add(
    "POST",
    "/api/cli/:cli/login/input",
    authed(async (ctx) => {
      const cli = requireKnown(ctx);
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body) || typeof body.input !== "string") {
        throw new HttpError(400, "invalid_body", "input must be a string");
      }
      try {
        return json(200, { login: await service.loginInput(cli, ctx.user?.id ?? "", body.input) });
      } catch (error) {
        if (error instanceof LoginBusyError) throw new HttpError(409, "login_in_progress", error.message);
        throw new HttpError(400, "invalid_body", "Login is not waiting for input");
      }
    }),
  );

  router.add(
    "DELETE",
    "/api/cli/:cli/login",
    authed((ctx) => {
      const cli = requireKnown(ctx);
      return json(200, { login: service.loginCancel(cli, ctx.user?.id ?? "") });
    }),
  );
}

function requireKnown(ctx: RequestContext): string {
  const name = ctx.params.cli ?? "";
  if (!isCliName(name)) {
    throw new HttpError(404, "not_found", "Unknown CLI");
  }
  return name;
}

async function wantsUpdate(ctx: RequestContext): Promise<boolean> {
  const text = await ctx.request.clone().text();
  if (text.trim() === "") return false;
  const body = await readJson(ctx.request, ctx.config);
  if (!isRecord(body)) throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  return body.update === true;
}
