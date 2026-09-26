import { randomUUID } from "node:crypto";
import { verifyPasscode } from "../auth/password.ts";
import { hashToken, newSessionToken, readBearer, readCookie } from "../auth/session.ts";
import type { ServerConfig } from "../config.ts";
import { clearSessionCookie, HttpError, isRecord, json, readJson, sessionCookie } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { Operator } from "../types.ts";

const operator: Operator = { id: "operator" };

export function registerAuth(router: Router): void {
  router.add("POST", "/api/auth/login", async (ctx) => {
    const secret = readSecret(await readJson(ctx.request, ctx.config));
    if (!ctx.rateLimiter.isAllowed(ctx.clientKey)) {
      throw new HttpError(429, "rate_limited", "Too many login attempts. Try again later.");
    }
    const accepted = await verifyPasscode(secret, ctx.config.auth);
    if (!accepted) {
      ctx.rateLimiter.recordFailure(ctx.clientKey);
      throw new HttpError(401, "unauthorized", "Invalid credentials");
    }
    ctx.rateLimiter.clear(ctx.clientKey);

    const token = newSessionToken();
    const expiresAt = new Date(ctx.now.getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
    await ctx.store.sessions.create({
      id: randomUUID(),
      tokenHash: hashToken(token),
      createdAt: ctx.now.toISOString(),
      expiresAt,
    });

    return json(
      200,
      { token, tokenType: "Bearer", expiresAt, operator },
      { "set-cookie": sessionCookie(token, ctx.config) },
    );
  });

  router.add("POST", "/api/auth/logout", async (ctx) => {
    if (ctx.session) {
      await ctx.store.sessions.delete(ctx.session.id);
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": clearSessionCookie(ctx.config) },
      });
    }
    if (!presentedCredential(ctx.request, ctx.config)) {
      throw new HttpError(401, "unauthorized", "Authentication required");
    }
    return json(
      401,
      { error: { code: "unauthorized", message: "Authentication required" } },
      { "set-cookie": clearSessionCookie(ctx.config) },
    );
  });

  router.add(
    "GET",
    "/api/auth/me",
    authed((ctx) => {
      const session = ctx.session;
      if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
      return json(200, {
        operator,
        deploymentMode: ctx.config.deploymentMode,
        brand: { name: ctx.config.brandName },
        session: { id: session.id, expiresAt: session.expiresAt },
      });
    }),
  );
}

function readSecret(body: unknown): string {
  if (!isRecord(body)) {
    throw new HttpError(400, "invalid_body", "JSON object expected");
  }
  const password = body.password;
  const passcode = body.passcode;
  if (password !== undefined && typeof password !== "string") {
    throw new HttpError(400, "invalid_body", "password must be a string");
  }
  if (passcode !== undefined && typeof passcode !== "string") {
    throw new HttpError(400, "invalid_body", "passcode must be a string");
  }
  if (typeof password === "string" && typeof passcode === "string" && password !== passcode) {
    throw new HttpError(400, "invalid_body", "password and passcode do not match");
  }
  const secret = typeof password === "string" ? password : passcode;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new HttpError(400, "invalid_body", "password or passcode is required");
  }
  if (secret.length > 1024) {
    throw new HttpError(400, "invalid_body", "password is too long");
  }
  return secret;
}

function presentedCredential(request: Request, config: ServerConfig): boolean {
  return (
    readBearer(request.headers.get("authorization")) !== null ||
    readCookie(request.headers.get("cookie"), config.cookieName) !== null
  );
}
