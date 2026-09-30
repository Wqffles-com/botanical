import { GITHUB_LISTENER_KIND, githubHookEvents } from "@botanical/core";

import { GithubApiError, githubRequest, parseRepo, repoPath } from "../github/api.ts";
import {
  deleteGithubConnection,
  githubAccount,
  githubCredentials,
  saveGithubConnection,
  verifyGithubToken,
} from "../github/connection.ts";
import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { authed, type RequestContext, type Router } from "../router.ts";
import { requireParam } from "../validate.ts";
import { hookUrl, publicOrigin } from "./listeners.ts";

const TOKEN_MAX = 512;

/**
 * The signed-in user's GitHub connection, their repositories, and creating the GitHub
 * webhook for a GitHub listener. The token is written once and never returned.
 */
export function registerGithub(router: Router): void {
  router.add(
    "GET",
    "/api/github",
    authed(async (ctx) => json(200, await connectionView(ctx))),
  );

  router.add(
    "PUT",
    "/api/github",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const token = isRecord(body) && typeof body.token === "string" ? body.token.trim() : "";
      if (!token) throw new HttpError(400, "invalid_body", "token is required");
      if (token.length > TOKEN_MAX || /\s/.test(token)) {
        throw new HttpError(400, "invalid_body", "That does not look like a GitHub token");
      }
      let account;
      try {
        account = await verifyGithubToken(ctx.config.github, token);
      } catch (error) {
        throw githubHttpError(error, "GitHub did not accept this token");
      }
      try {
        await saveGithubConnection(ctx.store, userId(ctx), token, account, ctx.now);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not store the token";
        if (message.includes("BOTANICAL_ENCRYPTION_KEY")) {
          throw new HttpError(503, "encryption_unconfigured", "Set BOTANICAL_ENCRYPTION_KEY before connecting GitHub");
        }
        throw error;
      }
      return json(200, await connectionView(ctx));
    }),
  );

  router.add(
    "DELETE",
    "/api/github",
    authed(async (ctx) => {
      await deleteGithubConnection(ctx.store, userId(ctx));
      return noContent();
    }),
  );

  router.add(
    "GET",
    "/api/github/repos",
    authed(async (ctx) => {
      const token = await requireToken(ctx);
      const query = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
      let rows: Array<Record<string, unknown>>;
      try {
        rows = (
          await githubRequest<Array<Record<string, unknown>>>(ctx.config.github, token, "GET", "/user/repos", {
            query: { sort: "updated", per_page: 100 },
          })
        ).data;
      } catch (error) {
        throw githubHttpError(error, "Could not list repositories");
      }
      const repos = rows
        .map((row) => {
          const permissions = isRecord(row.permissions) ? row.permissions : {};
          return {
            fullName: typeof row.full_name === "string" ? row.full_name : "",
            private: row.private === true,
            defaultBranch: typeof row.default_branch === "string" ? row.default_branch : "main",
            htmlUrl: typeof row.html_url === "string" ? row.html_url : "",
            description: typeof row.description === "string" ? row.description : null,
            canAdmin: permissions.admin === true,
            canPush: permissions.push === true,
          };
        })
        .filter((repo) => repo.fullName && (!query || repo.fullName.toLowerCase().includes(query)));
      return json(200, { repos });
    }),
  );

  router.add(
    "POST",
    "/api/listeners/:id/github-hook",
    authed(async (ctx) => {
      const listener = await ctx.store.listeners.get(requireParam(ctx.params, "id"));
      if (!listener) throw new HttpError(404, "not_found", "Listener not found");
      if (listener.kind !== GITHUB_LISTENER_KIND) {
        throw new HttpError(400, "invalid_body", "Only GitHub listeners can be connected to a repository");
      }
      const body = await readJson(ctx.request, ctx.config);
      let repo;
      try {
        repo = parseRepo(isRecord(body) ? body.repo : undefined, ctx.config.github.webUrl);
      } catch (error) {
        throw new HttpError(400, "invalid_body", error instanceof Error ? error.message : "repo is invalid");
      }
      const token = await requireToken(ctx);
      const events = githubHookEvents(listener.events);
      if (events.length === 0) throw new HttpError(400, "invalid_body", "The listener has no GitHub events");
      const url = hookUrl(publicOrigin(ctx.config, ctx.url), listener.id);
      const config = { url, content_type: "json", secret: listener.secret, insecure_ssl: "0" };
      let hook: Record<string, unknown>;
      let created = true;
      try {
        // Connecting again (after changing events or rotating the secret) updates the same hook.
        const existing = (
          await githubRequest<Array<Record<string, unknown>>>(ctx.config.github, token, "GET", `${repoPath(repo)}/hooks`, {
            query: { per_page: 100 },
          })
        ).data.find((item) => isRecord(item.config) && item.config.url === url);
        if (existing && typeof existing.id === "number") {
          created = false;
          hook = (
            await githubRequest<Record<string, unknown>>(
              ctx.config.github,
              token,
              "PATCH",
              `${repoPath(repo)}/hooks/${existing.id}`,
              { body: { active: true, events, config } },
            )
          ).data;
        } else {
          hook = (
            await githubRequest<Record<string, unknown>>(ctx.config.github, token, "POST", `${repoPath(repo)}/hooks`, {
              body: { name: "web", active: true, events, config },
            })
          ).data;
        }
      } catch (error) {
        throw githubHttpError(
          error,
          "GitHub did not create the webhook",
          "Creating a webhook needs admin access to the repository and a token with the admin:repo_hook scope (classic) or Webhooks: read and write (fine-grained).",
        );
      }
      const id = typeof hook.id === "number" ? hook.id : 0;
      return json(created ? 201 : 200, {
        hook: {
          id,
          repo: `${repo.owner}/${repo.name}`,
          events,
          htmlUrl: `${ctx.config.github.webUrl}/${repo.owner}/${repo.name}/settings/hooks/${id}`,
        },
      });
    }),
  );
}

async function connectionView(ctx: RequestContext) {
  const id = userId(ctx);
  const connected = (await githubCredentials(ctx.store, id)) !== null;
  return {
    connected,
    account: connected ? await githubAccount(ctx.store, id) : null,
    webUrl: ctx.config.github.webUrl,
  };
}

async function requireToken(ctx: RequestContext): Promise<string> {
  const credentials = await githubCredentials(ctx.store, userId(ctx));
  if (!credentials) throw new HttpError(409, "github_not_connected", "Connect GitHub in Settings first");
  return credentials.token;
}

function userId(ctx: RequestContext): string {
  const id = ctx.user?.id;
  if (!id) throw new HttpError(401, "unauthorized", "Authentication required");
  return id;
}

/** GitHub's answer as a 4xx the web can show. A GitHub outage is a 502. */
function githubHttpError(error: unknown, fallback: string, hint?: string): HttpError {
  if (!(error instanceof GithubApiError)) {
    return new HttpError(502, "github_error", error instanceof Error ? error.message : fallback);
  }
  if (error.status >= 500) return new HttpError(502, "github_error", error.message);
  const message = hint && (error.status === 403 || error.status === 404) ? `${error.message} ${hint}` : error.message;
  return new HttpError(error.status === 401 ? 400 : 422, "github_rejected", message);
}
