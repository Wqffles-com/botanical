import type { ServerConfig } from "./config.ts";
import { finish, HttpError, jsonError } from "./http.ts";
import type { LoginRateLimiter } from "./auth/rate-limit.ts";
import { resolveSession } from "./auth/session.ts";
import type { Session, Store } from "./types.ts";

export interface RequestContext {
  request: Request;
  url: URL;
  params: Readonly<Record<string, string>>;
  config: ServerConfig;
  store: Store;
  session: Session | null;
  clientKey: string;
  now: Date;
  rateLimiter: LoginRateLimiter;
}

export type RouteHandler = (ctx: RequestContext) => Promise<Response> | Response;

interface CompiledRoute {
  method: string;
  path: string;
  paramNames: string[];
  regex: RegExp;
  handler: RouteHandler;
}

export interface Router {
  add(method: string, path: string, handler: RouteHandler): void;
}

export function authed(handler: RouteHandler): RouteHandler {
  return async (ctx) => {
    if (!ctx.session) {
      throw new HttpError(401, "unauthorized", "Authentication required");
    }
    return handler(ctx);
  };
}

export function createRouter(): Router & {
  handle(request: Request, deps: RouterDeps): Promise<Response>;
} {
  const routes: CompiledRoute[] = [];

  return {
    add(method, path, handler) {
      const normalized = method.toUpperCase();
      if (routes.some((route) => route.method === normalized && route.path === path)) {
        throw new Error(`Duplicate route ${normalized} ${path}`);
      }
      const compiled = compile(path);
      routes.push({ method: normalized, path, ...compiled, handler });
    },
    async handle(request, deps) {
      const now = deps.now?.() ?? new Date();
      try {
        if (request.method === "OPTIONS") {
          return finish(
            new Response(null, {
              status: 204,
              headers: {
                "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
                "access-control-allow-headers": "Authorization, Content-Type, Accept",
                "access-control-max-age": "600",
              },
            }),
            deps.config,
          );
        }

        const url = new URL(request.url);
        const path = normalizePath(url.pathname);
        const matches = routes.filter((route) => route.regex.test(path));
        const route = matches.find((candidate) => candidate.method === request.method);
        if (!route) {
          if (matches.length > 0) {
            return finish(jsonError(405, "method_not_allowed", "Method not allowed"), deps.config);
          }
          return finish(jsonError(404, "not_found", "Not found"), deps.config);
        }

        let params: Record<string, string>;
        try {
          params = matchParams(route, path);
        } catch {
          return finish(jsonError(400, "invalid_path", "Invalid path encoding"), deps.config);
        }

        const session = await resolveSession(request, deps.store, deps.config, now);
        const response = await route.handler({
          request,
          url,
          params,
          config: deps.config,
          store: deps.store,
          session,
          clientKey: deps.clientKey,
          now,
          rateLimiter: deps.rateLimiter,
        });
        return finish(response, deps.config);
      } catch (err) {
        if (err instanceof HttpError) {
          return finish(jsonError(err.status, err.code, err.message), deps.config);
        }
        console.error(err);
        return finish(jsonError(500, "internal_error", "Internal server error"), deps.config);
      }
    },
  };
}

export interface RouterDeps {
  config: ServerConfig;
  store: Store;
  clientKey: string;
  rateLimiter: LoginRateLimiter;
  now?: () => Date;
}

function compile(path: string): { paramNames: string[]; regex: RegExp } {
  const paramNames: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { paramNames, regex: new RegExp(`^${pattern}$`) };
}

function matchParams(route: CompiledRoute, path: string): Record<string, string> {
  const match = route.regex.exec(path);
  const params: Record<string, string> = {};
  if (!match) return params;
  route.paramNames.forEach((name, index) => {
    const raw = match[index + 1];
    if (raw === undefined) return;
    params[name] = decodeURIComponent(raw);
  });
  return params;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}
