import { randomUUID } from "node:crypto";
import { hashToken, newSessionToken } from "../auth/session.ts";
import { readBearer, readCookie } from "../auth/session.ts";
import type { ServerConfig } from "../config.ts";
import { clearSessionCookie, HttpError, isRecord, json, readJson, sessionCookie } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { AuthUser } from "../types.ts";

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const MIN_PASSWORD = 8;

export function registerAuth(router: Router): void {
  router.add("GET", "/api/auth/config", async (ctx) => {
    const active = await ctx.store.accounts.countActive();
    const signupMode = await ctx.store.accounts.signupMode();
    return json(200, {
      signupMode,
      hasUsers: active > 0,
      canSignup: active === 0 || signupMode === "open",
    });
  });

  router.add("POST", "/api/auth/signup", async (ctx) => {
    const input = readSignup(await readJson(ctx.request, ctx.config));
    if (!ctx.rateLimiter.isAllowed(ctx.clientKey)) {
      throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
    }
    const active = await ctx.store.accounts.countActive();
    const mode = await ctx.store.accounts.signupMode();
    if (active > 0 && mode === "closed") {
      throw new HttpError(403, "signup_closed", "Signup is closed");
    }
    if (active > 0 && mode === "invite") {
      if (!input.inviteToken) throw new HttpError(403, "invite_required", "An invite link is required");
      const valid = await ctx.store.accounts.inviteValid(hashToken(input.inviteToken), ctx.now);
      if (!valid) throw new HttpError(403, "invite_required", "That invite link is invalid or expired");
    }
    const existing = await ctx.store.accounts.findByEmail(input.email);
    if (existing) {
      ctx.rateLimiter.recordFailure(ctx.clientKey);
      throw new HttpError(409, "email_taken", "An account with that email already exists");
    }
    const passwordHash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
    let user: AuthUser;
    const unclaimed = active === 0 ? await ctx.store.accounts.unclaimedOwner() : null;
    if (unclaimed) {
      user = await ctx.store.accounts.claimOwner(unclaimed.id, {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      });
    } else {
      const role = active === 0 ? "admin" : "member";
      user = await ctx.store.accounts.insertUser({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        role,
      });
    }
    if (active > 0 && mode === "invite") {
      const accepted = await ctx.store.accounts.takeInvite(hashToken(input.inviteToken ?? ""), user.id, ctx.now);
      if (!accepted) {
        throw new HttpError(403, "invite_required", "That invite link is invalid or expired");
      }
    }
    ctx.rateLimiter.clear(ctx.clientKey);
    return issueSession(ctx, user);
  });

  router.add("POST", "/api/auth/login", async (ctx) => {
    const input = readLogin(await readJson(ctx.request, ctx.config));
    if (!ctx.rateLimiter.isAllowed(ctx.clientKey)) {
      throw new HttpError(429, "rate_limited", "Too many login attempts. Try again later.");
    }
    const user = await ctx.store.accounts.findByEmail(input.email);
    const accepted = user ? await Bun.password.verify(input.password, user.passwordHash) : false;
    if (!user || !accepted) {
      ctx.rateLimiter.recordFailure(ctx.clientKey);
      throw new HttpError(401, "unauthorized", "Invalid email or password");
    }
    ctx.rateLimiter.clear(ctx.clientKey);
    return issueSession(ctx, user);
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
    authed(async (ctx) => {
      const session = ctx.session;
      const user = ctx.user;
      if (!session || !user) throw new HttpError(401, "unauthorized", "Authentication required");
      return json(200, {
        user: publicUser(user),
        deploymentMode: ctx.config.deploymentMode,
        brand: { name: ctx.config.brandName },
        session: { id: session.id, expiresAt: session.expiresAt },
      });
    }),
  );
}

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

async function issueSession(
  ctx: { store: { sessions: { create(session: { id: string; userId: string; tokenHash: string; createdAt: string; expiresAt: string }): Promise<unknown> } }; config: ServerConfig; now: Date },
  user: AuthUser,
) {
  const token = newSessionToken();
  const expiresAt = new Date(ctx.now.getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
  await ctx.store.sessions.create({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    createdAt: ctx.now.toISOString(),
    expiresAt,
  });
  return json(
    200,
    { token, tokenType: "Bearer", expiresAt, user: publicUser(user) },
    { "set-cookie": sessionCookie(token, ctx.config) },
  );
}

function readLogin(body: unknown): { email: string; password: string } {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const email = readEmail(body.email);
  const password = readPassword(body.password, false);
  return { email, password };
}

function readSignup(body: unknown): { email: string; password: string; displayName: string; inviteToken?: string } {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const email = readEmail(body.email);
  const password = readPassword(body.password, true);
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 80) {
    throw new HttpError(400, "invalid_body", "Display name must be 1-80 characters");
  }
  let inviteToken: string | undefined;
  if (body.inviteToken !== undefined) {
    if (typeof body.inviteToken !== "string" || body.inviteToken.trim() === "") {
      throw new HttpError(400, "invalid_body", "inviteToken must be a string");
    }
    inviteToken = body.inviteToken.trim();
  }
  return { email, password, displayName, ...(inviteToken ? { inviteToken } : {}) };
}

function readEmail(value: unknown): string {
  if (typeof value !== "string" || !EMAIL.test(value.trim()) || value.trim().length > 200) {
    throw new HttpError(400, "invalid_body", "Enter a valid email");
  }
  return value.trim().toLowerCase();
}

function readPassword(value: unknown, enforceLength: boolean): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_body", "Password is required");
  }
  if (value.length > 1024) throw new HttpError(400, "invalid_body", "Password is too long");
  if (enforceLength && value.length < MIN_PASSWORD) {
    throw new HttpError(400, "invalid_body", "Password must be at least 8 characters");
  }
  return value;
}

function presentedCredential(request: Request, config: ServerConfig): boolean {
  return (
    readBearer(request.headers.get("authorization")) !== null ||
    readCookie(request.headers.get("cookie"), config.cookieName) !== null
  );
}
