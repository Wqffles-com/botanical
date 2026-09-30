import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GITHUB_AGENT_MARKER } from "@botanical/core";
import { runAsUser } from "@botanical/db";

import { decideGithubDelivery } from "../src/github/webhook.ts";
import { createGithubContributor } from "../src/github/tools.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

const GOOD_TOKEN = "ghp_goodtoken0000000000000000000000000000";

interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

/** A stand-in for api.github.com. Only GOOD_TOKEN is accepted. */
let fake: ReturnType<typeof Bun.serve>;
const recorded: Recorded[] = [];
const hooks: Array<{ id: number; config: { url: string } }> = [];

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const text = await request.text();
      recorded.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get("authorization"),
        body: text ? JSON.parse(text) : null,
      });
      if (request.headers.get("authorization") !== `Bearer ${GOOD_TOKEN}`) {
        return Response.json({ message: "Bad credentials" }, { status: 401 });
      }
      if (url.pathname === "/user") {
        return Response.json(
          { login: "octo", id: 42, name: "Octo Cat", avatar_url: "https://avatars/42", html_url: "https://github.com/octo" },
          { headers: { "x-oauth-scopes": "repo, admin:repo_hook" } },
        );
      }
      if (url.pathname === "/user/repos") {
        return Response.json([
          { full_name: "octo/garden", private: true, default_branch: "main", html_url: "https://github.com/octo/garden", permissions: { admin: true, push: true } },
          { full_name: "octo/shed", private: false, default_branch: "trunk", html_url: "https://github.com/octo/shed", permissions: { admin: false, push: true } },
        ]);
      }
      if (url.pathname === "/repos/octo/garden/hooks" && request.method === "GET") {
        return Response.json(hooks);
      }
      if (url.pathname === "/repos/octo/garden/hooks" && request.method === "POST") {
        const body = JSON.parse(text) as { config: { url: string } };
        hooks.push({ id: 7, config: { url: body.config.url } });
        return Response.json({ id: 7 }, { status: 201 });
      }
      if (url.pathname === "/repos/octo/garden/hooks/7" && request.method === "PATCH") {
        return Response.json({ id: 7 });
      }
      if (url.pathname === "/repos/octo/garden/issues/5/comments" && request.method === "POST") {
        return Response.json({ id: 99, html_url: "https://github.com/octo/garden/issues/5#issuecomment-99" }, { status: 201 });
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  fake.stop(true);
});

function appWithGithub() {
  return setup({ BOTANICAL_GITHUB_API_URL: `http://127.0.0.1:${fake.port}` });
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function connect(app: ReturnType<typeof setup>["app"], token: string, githubToken = GOOD_TOKEN) {
  return app.fetch(
    new Request("http://localhost/api/github", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ token: githubToken }),
    }),
  );
}

describe("GitHub connection", () => {
  test("checks the token with GitHub, stores it, and never returns it", async () => {
    const { app } = appWithGithub();
    const { token } = await login(app);
    const before = await readJson<{ connected: boolean }>(
      await app.fetch(new Request("http://localhost/api/github", { headers: bearer(token) })),
    );
    expect(before.connected).toBe(false);

    const rejected = await connect(app, token, "ghp_wrong");
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain("rejected the token");

    const saved = await connect(app, token);
    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain(GOOD_TOKEN);
    const view = JSON.parse(body) as { connected: boolean; account: { login: string; id: number; scopes: string[] } };
    expect(view.connected).toBe(true);
    expect(view.account.login).toBe("octo");
    expect(view.account.id).toBe(42);
    expect(view.account.scopes).toEqual(["repo", "admin:repo_hook"]);

    const repos = await readJson<{ repos: Array<{ fullName: string; canAdmin: boolean }> }>(
      await app.fetch(new Request("http://localhost/api/github/repos?q=gar", { headers: bearer(token) })),
    );
    expect(repos.repos).toEqual([expect.objectContaining({ fullName: "octo/garden", canAdmin: true })]);

    const deleted = await app.fetch(new Request("http://localhost/api/github", { method: "DELETE", headers: bearer(token) }));
    expect(deleted.status).toBe(204);
    const after = await readJson<{ connected: boolean }>(
      await app.fetch(new Request("http://localhost/api/github", { headers: bearer(token) })),
    );
    expect(after.connected).toBe(false);
  });

  test("the generic secrets route cannot write the GitHub token", async () => {
    const { app } = appWithGithub();
    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/settings/secrets/github", {
        method: "PUT",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ value: GOOD_TOKEN }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("repositories need a connection", async () => {
    const { app } = appWithGithub();
    const { token } = await login(app);
    const response = await app.fetch(new Request("http://localhost/api/github/repos", { headers: bearer(token) }));
    expect(response.status).toBe(409);
  });
});

describe("GitHub listeners", () => {
  async function githubListener(app: ReturnType<typeof setup>["app"], token: string, events?: string[]) {
    const agent = await createAgent(app, token, { name: "Ada" });
    const response = await app.fetch(
      new Request("http://localhost/api/listeners", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ agentId: agent.id, name: "Issues", kind: "github", profileId: "grok", ...(events ? { events } : {}) }),
      }),
    );
    expect(response.status).toBe(201);
    return readJson<{ listener: { id: string; kind: string; events: string[] }; secret: string }>(response);
  }

  function deliver(app: ReturnType<typeof setup>["app"], id: string, secret: string, event: string, payload: unknown) {
    const body = JSON.stringify(payload);
    return app.fetch(
      new Request(`http://localhost/api/hooks/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": sign(secret, body) },
        body,
      }),
    );
  }

  const issue = {
    action: "opened",
    repository: { full_name: "octo/garden" },
    sender: { login: "someone" },
    issue: {
      number: 5,
      title: "Leaves are yellow",
      body: "Please look at the ferns.",
      html_url: "https://github.com/octo/garden/issues/5",
      user: { login: "someone" },
      labels: [{ name: "bug" }],
    },
  };

  test("defaults to issues.opened and rejects events on webhook listeners", async () => {
    const { app } = appWithGithub();
    const { token } = await login(app);
    const created = await githubListener(app, token);
    expect(created.listener.kind).toBe("github");
    expect(created.listener.events).toEqual(["issues.opened"]);

    const agent = await createAgent(app, token, { name: "Bo" });
    const webhook = await app.fetch(
      new Request("http://localhost/api/listeners", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ agentId: agent.id, name: "Hook", profileId: "grok", events: ["issues.opened"] }),
      }),
    );
    expect(webhook.status).toBe(400);
    const unknown = await app.fetch(
      new Request(`http://localhost/api/listeners/${created.listener.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ events: ["push"] }),
      }),
    );
    expect(unknown.status).toBe(400);
  });

  test("runs a turn for a signed issue and ignores pings, other events, and agent-written issues", async () => {
    const { app, store } = appWithGithub();
    const { token } = await login(app);
    const created = await githubListener(app, token);
    const id = created.listener.id;

    const unsigned = await app.fetch(
      new Request(`http://localhost/api/hooks/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-event": "issues", authorization: `Bearer ${created.secret}` },
        body: JSON.stringify(issue),
      }),
    );
    expect(unsigned.status).toBe(401);

    const ping = await deliver(app, id, created.secret, "ping", { zen: "Keep it simple." });
    expect(ping.status).toBe(202);
    expect((await readJson<{ ignored?: boolean }>(ping)).ignored).toBe(true);
    const closed = await deliver(app, id, created.secret, "issues", { ...issue, action: "closed" });
    expect((await readJson<{ ignored?: boolean }>(closed)).ignored).toBe(true);
    const own = await deliver(app, id, created.secret, "issues", {
      ...issue,
      issue: { ...issue.issue, body: `Filed by an agent\n\n${GITHUB_AGENT_MARKER}` },
    });
    expect((await readJson<{ ignored?: boolean }>(own)).ignored).toBe(true);

    const opened = await deliver(app, id, created.secret, "issues", issue);
    expect(opened.status).toBe(202);
    expect((await readJson<{ ignored?: boolean }>(opened)).ignored).toBeUndefined();
    await app.turns.whenIdle();

    const deliveries = await readJson<{ deliveries: Array<{ status: string; error: string | null; chatId: string | null }> }>(
      await app.fetch(new Request(`http://localhost/api/listeners/${id}/deliveries`, { headers: bearer(token) })),
    );
    expect(deliveries.deliveries.filter((item) => item.status === "ignored")).toHaveLength(3);
    const ran = deliveries.deliveries.find((item) => item.status === "succeeded");
    expect(ran?.chatId).toBeTruthy();
    const owner = await store.accounts.findByEmail("admin@example.com");
    const messages = await runAsUser(owner?.id ?? "", () => store.messages.listByChat(ran?.chatId ?? ""));
    const prompt = messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt.startsWith("[GitHub · ")).toBe(true);
    expect(prompt).toContain("Event: issues.opened");
    expect(prompt).toContain("Issue #5: Leaves are yellow");
    expect(prompt).toContain("Please look at the ferns.");
    expect(prompt).toContain("<untrusted_webhook_payload>");
  });

  test("creates the webhook on GitHub with the listener secret and events", async () => {
    const { app } = appWithGithub();
    const { token } = await login(app);
    const created = await githubListener(app, token, ["issues.opened", "issue_comment.created"]);
    const notConnected = await app.fetch(
      new Request(`http://localhost/api/listeners/${created.listener.id}/github-hook`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ repo: "octo/garden" }),
      }),
    );
    expect(notConnected.status).toBe(409);
    expect((await connect(app, token)).status).toBe(200);
    recorded.length = 0;
    const response = await app.fetch(
      new Request(`http://localhost/api/listeners/${created.listener.id}/github-hook`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ repo: "https://github.com/octo/garden" }),
      }),
    );
    expect(response.status).toBe(201);
    const { hook } = await readJson<{ hook: { id: number; repo: string; events: string[] } }>(response);
    expect(hook).toMatchObject({ id: 7, repo: "octo/garden", events: ["issues", "issue_comment"] });
    const call = recorded.find((item) => item.path === "/repos/octo/garden/hooks");
    expect(call?.body).toMatchObject({
      events: ["issues", "issue_comment"],
      config: { url: `http://localhost/api/hooks/${created.listener.id}`, secret: created.secret, content_type: "json" },
    });

    // Connecting again updates the same webhook instead of adding a second one.
    const again = await app.fetch(
      new Request(`http://localhost/api/listeners/${created.listener.id}/github-hook`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ repo: "octo/garden" }),
      }),
    );
    expect(again.status).toBe(200);
    expect(recorded.some((item) => item.method === "PATCH" && item.path === "/repos/octo/garden/hooks/7")).toBe(true);
    expect(hooks).toHaveLength(1);
  });
});

describe("GitHub deliveries", () => {
  test("a comment on a pull request conversation is summarized with the comment", () => {
    const decision = decideGithubDelivery({
      headers: new Headers({ "x-github-event": "issue_comment" }),
      body: JSON.stringify({
        action: "created",
        repository: { full_name: "octo/garden" },
        issue: { number: 9, title: "Add ferns", pull_request: {}, html_url: "u", user: { login: "a" } },
        comment: { body: "Looks good", user: { login: "b" }, html_url: "c" },
      }),
      events: ["issue_comment.created"],
    });
    expect(decision.run).toBe(true);
    if (!decision.run) return;
    expect(decision.payload).toContain("Pull request #9: Add ferns");
    expect(decision.payload).toContain("Comment by b: c");
    expect(decision.payload).toContain("Looks good");
  });

  test("a person's comment on an issue an agent opened still runs; the agent's own comment does not", () => {
    const base = {
      action: "created",
      repository: { full_name: "octo/garden" },
      issue: { number: 3, title: "Filed by an agent", body: `Details\n\n${GITHUB_AGENT_MARKER}` },
    };
    const person = decideGithubDelivery({
      headers: new Headers({ "x-github-event": "issue_comment" }),
      body: JSON.stringify({ ...base, comment: { body: "Thanks", user: { login: "b" } } }),
      events: ["issue_comment.created"],
    });
    expect(person.run).toBe(true);
    const agent = decideGithubDelivery({
      headers: new Headers({ "x-github-event": "issue_comment" }),
      body: JSON.stringify({ ...base, comment: { body: `Done\n\n${GITHUB_AGENT_MARKER}`, user: { login: "b" } } }),
      events: ["issue_comment.created"],
    });
    expect(agent.run).toBe(false);
  });
});

describe("GitHub tools", () => {
  test("act as the connected user and mark what they write", async () => {
    const { app, store, config } = appWithGithub();
    const { token } = await login(app);
    const contributor = createGithubContributor(store, config.github);
    const me = await readJson<{ user: { id: string } }>(
      await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) })),
    );
    const ctx = { agentId: "agent", chatId: "chat" };
    const args = { repo: "octo/garden", number: 5, body: "On it." };

    const missing = await runAsUser(me.user.id, () => contributor.callTool("github_issue_comment", args, ctx));
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("Settings → GitHub");

    expect((await connect(app, token)).status).toBe(200);
    recorded.length = 0;
    const result = await runAsUser(me.user.id, () => contributor.callTool("github_issue_comment", args, ctx));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("issuecomment-99");
    expect(recorded[0]?.authorization).toBe(`Bearer ${GOOD_TOKEN}`);
    expect(recorded[0]?.body).toEqual({ body: `On it.\n\n${GITHUB_AGENT_MARKER}` });

    const bad = await runAsUser(me.user.id, () =>
      contributor.callTool("github_issue_comment", { ...args, repo: "../../etc" }, ctx),
    );
    expect(bad.isError).toBe(true);
  });
});
