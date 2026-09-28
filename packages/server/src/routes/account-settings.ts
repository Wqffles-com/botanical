import { hashToken, newSessionToken } from "../auth/session.ts";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { adminOnly, authed, type Router } from "../router.ts";
import { MODEL_PROVIDERS, type ModelProfile, type ModelProvider } from "../types.ts";
import { SIGNUP_MODES, type SignupMode } from "@botanical/db";

const SECRET_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

export function registerAccountSettings(router: Router): void {
  router.add(
    "GET",
    "/api/admin/settings",
    adminOnly(async (ctx) => {
      return json(200, {
        signupMode: await ctx.store.accounts.signupMode(),
        allowGlobalKeys: await ctx.store.accounts.allowGlobalKeys(),
        secrets: await ctx.store.secrets.listGlobal(),
      });
    }),
  );

  router.add(
    "PATCH",
    "/api/admin/settings",
    adminOnly(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      if (body.signupMode !== undefined) {
        if (!SIGNUP_MODES.includes(body.signupMode as SignupMode)) {
          throw new HttpError(400, "invalid_body", "signupMode must be open, invite, or closed");
        }
        await ctx.store.accounts.setSignupMode(body.signupMode as SignupMode);
      }
      if (body.allowGlobalKeys !== undefined) {
        if (typeof body.allowGlobalKeys !== "boolean") {
          throw new HttpError(400, "invalid_body", "allowGlobalKeys must be a boolean");
        }
        await ctx.store.accounts.setAllowGlobalKeys(body.allowGlobalKeys);
      }
      return json(200, {
        signupMode: await ctx.store.accounts.signupMode(),
        allowGlobalKeys: await ctx.store.accounts.allowGlobalKeys(),
      });
    }),
  );

  router.add(
    "PUT",
    "/api/admin/secrets/:name",
    adminOnly(async (ctx) => {
      const name = secretName(ctx.params.name);
      const value = readSecretValue(await readJson(ctx.request, ctx.config));
      try {
        const saved = await ctx.store.secrets.putGlobal(name, value);
        return json(200, { secret: saved });
      } catch (error) {
        throw secretError(error);
      }
    }),
  );

  router.add(
    "DELETE",
    "/api/admin/secrets/:name",
    adminOnly(async (ctx) => {
      await ctx.store.secrets.deleteGlobal(secretName(ctx.params.name));
      return new Response(null, { status: 204 });
    }),
  );

  router.add(
    "GET",
    "/api/admin/profiles",
    adminOnly(async (ctx) => json(200, { profiles: await ctx.store.globalProfiles.list() })),
  );

  router.add(
    "POST",
    "/api/admin/profiles",
    adminOnly(async (ctx) => {
      const profile = readProfile(await readJson(ctx.request, ctx.config));
      const saved = await ctx.store.globalProfiles.upsert(profile);
      return json(201, { profile: saved });
    }),
  );

  router.add(
    "DELETE",
    "/api/admin/profiles/:id",
    adminOnly(async (ctx) => {
      const removed = await ctx.store.globalProfiles.delete(ctx.params.id ?? "");
      if (!removed) throw new HttpError(404, "not_found", "Profile not found");
      return new Response(null, { status: 204 });
    }),
  );

  router.add(
    "POST",
    "/api/admin/invites",
    adminOnly(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const days = isRecord(body) && typeof body.days === "number" ? body.days : 7;
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        throw new HttpError(400, "invalid_body", "days must be between 1 and 90");
      }
      const token = newSessionToken();
      const expiresAt = new Date(ctx.now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      const invite = await ctx.store.accounts.createInvite({
        createdBy: ctx.user?.id ?? "",
        tokenHash: hashToken(token),
        expiresAt,
      });
      const origin = ctx.config.publicOrigin ?? ctx.url.origin;
      return json(201, {
        invite: { ...invite, token },
        url: `${origin.replace(/\/$/, "")}/login?invite=${encodeURIComponent(token)}`,
      });
    }),
  );

  router.add(
    "GET",
    "/api/admin/invites",
    adminOnly(async (ctx) => json(200, { invites: await ctx.store.accounts.listInvites() })),
  );

  router.add(
    "DELETE",
    "/api/admin/invites/:id",
    adminOnly(async (ctx) => {
      const removed = await ctx.store.accounts.deleteInvite(ctx.params.id ?? "");
      if (!removed) throw new HttpError(404, "not_found", "Invite not found");
      return new Response(null, { status: 204 });
    }),
  );

  router.add(
    "GET",
    "/api/settings/secrets",
    authed(async (ctx) => {
      const userId = ctx.user?.id ?? "";
      return json(200, {
        secrets: await ctx.store.secrets.listUser(userId),
        allowGlobalKeys: await ctx.store.accounts.allowGlobalKeys(),
      });
    }),
  );

  router.add(
    "PUT",
    "/api/settings/secrets/:name",
    authed(async (ctx) => {
      const value = readSecretValue(await readJson(ctx.request, ctx.config));
      try {
        const saved = await ctx.store.secrets.putUser(ctx.user?.id ?? "", secretName(ctx.params.name), value);
        return json(200, { secret: saved });
      } catch (error) {
        throw secretError(error);
      }
    }),
  );

  router.add(
    "DELETE",
    "/api/settings/secrets/:name",
    authed(async (ctx) => {
      await ctx.store.secrets.deleteUser(ctx.user?.id ?? "", secretName(ctx.params.name));
      return new Response(null, { status: 204 });
    }),
  );

  router.add(
    "GET",
    "/api/settings/speech",
    authed(async (ctx) => json(200, { speech: await speechView(ctx.store, ctx.user?.id ?? null) })),
  );

  router.add(
    "PUT",
    "/api/settings/speech",
    authed(async (ctx) => {
      await writeSpeech(ctx.store, ctx.user?.id ?? "", await readJson(ctx.request, ctx.config));
      return json(200, { speech: await speechView(ctx.store, ctx.user?.id ?? null) });
    }),
  );

  router.add(
    "PUT",
    "/api/admin/speech",
    adminOnly(async (ctx) => {
      await writeSpeech(ctx.store, null, await readJson(ctx.request, ctx.config));
      return json(200, { speech: await speechView(ctx.store, null) });
    }),
  );
}

function secretName(value: string | undefined): string {
  const name = (value ?? "").trim().toLowerCase();
  if (!SECRET_NAME.test(name)) throw new HttpError(400, "invalid_body", "Invalid secret name");
  return name;
}

function readSecretValue(body: unknown): string {
  if (!isRecord(body) || typeof body.value !== "string" || body.value.trim() === "") {
    throw new HttpError(400, "invalid_body", "value is required");
  }
  if (body.value.length > 8_000) throw new HttpError(400, "invalid_body", "value is too long");
  return body.value;
}

function secretError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : "Could not store the secret";
  if (message.includes("BOTANICAL_ENCRYPTION_KEY")) {
    return new HttpError(503, "encryption_unconfigured", "Set BOTANICAL_ENCRYPTION_KEY before storing secrets");
  }
  return new HttpError(400, "invalid_body", message);
}

function readProfile(body: unknown): ModelProfile {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!id || !name || !provider || !model) {
    throw new HttpError(400, "invalid_body", "id, name, provider, and model are required");
  }
  if (!(MODEL_PROVIDERS as readonly string[]).includes(provider) && provider !== "cli") {
    throw new HttpError(400, "invalid_body", "Unknown provider");
  }
  const profile: ModelProfile = { id, name, provider: provider as ModelProvider | "cli", model };
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) profile.baseUrl = body.baseUrl.trim();
  if (typeof body.kind === "string") profile.kind = body.kind === "cli" ? "cli" : "api";
  if (body.cli === "grok" || body.cli === "claude" || body.cli === "codex") profile.cli = body.cli;
  if (body.description === null || typeof body.description === "string") profile.description = body.description;
  return profile;
}

async function speechView(store: { prefs: { globalByPrefix(prefix: string): Promise<Record<string, unknown>>; userByPrefix(userId: string, prefix: string): Promise<Record<string, unknown>> } }, userId: string | null) {
  const global = await store.prefs.globalByPrefix("stt.");
  const user = userId ? await store.prefs.userByPrefix(userId, "stt.") : {};
  return { ...global, ...user };
}

async function writeSpeech(store: { prefs: { setGlobal(key: string, value: unknown): Promise<void>; setUser(userId: string, key: string, value: unknown): Promise<void> } }, userId: string | null, body: unknown) {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const write = async (key: string, value: unknown) => {
    if (userId) await store.prefs.setUser(userId, key, value);
    else await store.prefs.setGlobal(key, value);
  };
  if (body.mode !== undefined) {
    if (body.mode !== "server" && body.mode !== "browser") {
      throw new HttpError(400, "invalid_body", "mode must be server or browser");
    }
    await write("stt.mode", body.mode);
  }
  if (typeof body.provider === "string") await write("stt.provider", body.provider);
  if (typeof body.baseUrl === "string") await write("stt.base_url", body.baseUrl);
  if (typeof body.model === "string") await write("stt.model", body.model);
}
