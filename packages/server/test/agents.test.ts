import { describe, expect, test } from "bun:test";
import { EXAMPLE_AGENTS } from "@botanical/core";
import type { App } from "../src/app.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

function postJson(app: App, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

interface AgentBody {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  tools: string[];
  toolIds: string[];
  defaultProfileId: string | null;
}

describe("agent identity", () => {
  test("defaults icon to Bot and color to green", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await postJson(
      app,
      "/api/agents",
      { name: "Sprig", prompt: "Be brief." },
      bearer(token),
    );
    expect(response.status).toBe(201);
    const { agent } = await readJson<{ agent: AgentBody }>(response);
    expect(agent.icon).toBe("Bot");
    expect(agent.color).toBe("green");
    expect(agent.prompt).toBe("Be brief.");
    expect(agent.systemPrompt).toBe("Be brief.");
    expect(agent.tools).toEqual([]);
    expect(agent.toolIds).toEqual([]);
    expect(agent.defaultProfileId).toBeNull();
  });

  test("stores icon, color, tools, and a suggested profile", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const created = await postJson(
      app,
      "/api/agents",
      {
        name: "Scout",
        description: "Looks things up",
        prompt: "Search first.",
        tools: ["web_search", "web_fetch"],
        icon: "Search",
        color: "amber",
        defaultProfileId: "grok",
      },
      bearer(token),
    );
    expect(created.status).toBe(201);
    const { agent } = await readJson<{ agent: AgentBody }>(created);
    expect(agent).toMatchObject({
      name: "Scout",
      icon: "Search",
      color: "amber",
      prompt: "Search first.",
      systemPrompt: "Search first.",
      tools: ["web_search", "web_fetch"],
      toolIds: ["web_search", "web_fetch"],
      defaultProfileId: "grok",
    });

    const patched = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ icon: "Leaf", color: "teal", defaultProfileId: null }),
      }),
    );
    expect(patched.status).toBe(200);
    const next = (await readJson<{ agent: AgentBody }>(patched)).agent;
    expect(next.icon).toBe("Leaf");
    expect(next.color).toBe("teal");
    expect(next.defaultProfileId).toBeNull();
    expect(next.prompt).toBe("Search first.");
    expect(next.name).toBe("Scout");
  });

  test("accepts the systemPrompt and toolIds aliases", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Alias", toolIds: ["file_read"] });
    const fetched = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, { headers: bearer(token) }),
    );
    const body = (await readJson<{ agent: AgentBody }>(fetched)).agent;
    expect(body.systemPrompt).toBe(agent.systemPrompt);
    expect(body.toolIds).toEqual(agent.toolIds);
    expect(body.prompt).toBe(body.systemPrompt);
    expect(body.tools).toEqual(body.toolIds);
    expect(body.icon).toBe("Bot");
    expect(body.color).toBe("green");
  });

  test("rejects a long name, a bad icon, a bad color, and mismatched aliases", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const headers = bearer(token);

    const longName = await postJson(
      app,
      "/api/agents",
      { name: "x".repeat(41), prompt: "ok" },
      headers,
    );
    expect(longName.status).toBe(400);

    const badIcon = await postJson(
      app,
      "/api/agents",
      { name: "Ok", prompt: "ok", icon: "sprout" },
      headers,
    );
    expect(badIcon.status).toBe(400);

    const badColor = await postJson(
      app,
      "/api/agents",
      { name: "Ok", prompt: "ok", color: "lime" },
      headers,
    );
    expect(badColor.status).toBe(400);

    const mismatch = await postJson(
      app,
      "/api/agents",
      { name: "Ok", prompt: "one", systemPrompt: "two" },
      headers,
    );
    expect(mismatch.status).toBe(400);

    const emptyPatch = await app.fetch(
      new Request("http://localhost/api/agents/missing", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({}),
      }),
    );
    expect(emptyPatch.status).toBe(400);
  });

  test("the memory store seeds three example agents with distinct icons and colors", async () => {
    const store = createMemoryStore({ seed: true });
    const { app } = setup({}, { store });
    const { token } = await login(app);
    const listed = await readJson<{ agents: AgentBody[] }>(
      await app.fetch(new Request("http://localhost/api/agents", { headers: bearer(token) })),
    );
    expect(listed.agents.map((agent) => ({ name: agent.name, icon: agent.icon, color: agent.color }))).toEqual(
      EXAMPLE_AGENTS.map((agent) => ({ name: agent.name, icon: agent.icon, color: agent.color })),
    );
    expect(listed.agents.map((agent) => agent.id)).toEqual(EXAMPLE_AGENTS.map((agent) => agent.id));
    for (const agent of listed.agents) {
      expect(agent.prompt.length).toBeGreaterThan(0);
      expect(agent.systemPrompt).toBe(agent.prompt);
      expect(agent.tools).toEqual(agent.toolIds);
      expect(agent.defaultProfileId).toBeNull();
    }
    const names = listed.agents.map((agent) => agent.name);
    expect(names).toEqual(["Gardener", "Builder", "Scout"]);
  });
});
