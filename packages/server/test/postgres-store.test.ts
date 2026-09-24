import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createStore } from "../src/db/store.ts";
import { PASSWORD, bearer, login, readJson } from "./helpers.ts";

const baseUrl = process.env.BOTANICAL_TEST_DATABASE_URL;
const integration = baseUrl ? test : test.skip;

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

describe("postgres server boot", () => {
  integration(
    "migrates, serves the API, and keeps sessions after a new store is opened",
    async () => {
      if (!baseUrl) throw new Error("BOTANICAL_TEST_DATABASE_URL is required");
      const databaseUrl = withDatabase(baseUrl, "botanical_m11_server");
      const config = loadConfig({
        BOTANICAL_PASSWORD: PASSWORD,
        DATABASE_URL: databaseUrl,
        BOTANICAL_PROFILES: JSON.stringify([
          { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
          { id: "fast", name: "Fast", provider: "deepseek", model: "deepseek-chat" },
        ]),
      });
      const store = await createStore(config);
      expect(store.kind).toBe("postgres");
      const app = createApp({ config, store });
      try {
        const health = await readJson<{ persistence: string }>(
          await app.fetch(new Request("http://localhost/api/health")),
        );
        expect(health.persistence).toBe("postgres");

        const { token } = await login(app);
        const created = await app.fetch(
          new Request("http://localhost/api/agents", {
            method: "POST",
            headers: { "content-type": "application/json", ...bearer(token) },
            body: JSON.stringify({
              name: "Research",
              description: "Looks things up",
              systemPrompt: "Search carefully.",
              toolIds: ["web_search"],
              icon: "Search",
              color: "blue",
              defaultProfileId: "grok",
            }),
          }),
        );
        expect(created.status).toBe(201);
        const agent = await readJson<{ agent: { id: string; icon: string; color: string } }>(created);
        expect(agent.agent).toMatchObject({ icon: "Search", color: "blue" });

        const chatResponse = await app.fetch(
          new Request("http://localhost/api/chats", {
            method: "POST",
            headers: { "content-type": "application/json", ...bearer(token) },
            body: JSON.stringify({ agentId: agent.agent.id, profileId: "grok", title: "Notes" }),
          }),
        );
        expect(chatResponse.status).toBe(201);
        const chat = await readJson<{ chat: { id: string; profileId: string } }>(chatResponse);
        expect(chat.chat.profileId).toBe("grok");

        const posted = await app.fetch(
          new Request(`http://localhost/api/chats/${chat.chat.id}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", ...bearer(token) },
            body: JSON.stringify({ content: "Hello from postgres", profileId: "grok", stream: false }),
          }),
        );
        expect(posted.status).toBe(201);

        const listed = await readJson<{ messages: { role: string; content: string }[] }>(
          await app.fetch(
            new Request(`http://localhost/api/chats/${chat.chat.id}/messages`, { headers: bearer(token) }),
          ),
        );
        expect(listed.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(listed.messages[0]?.content).toBe("Hello from postgres");

        await store.close();

        const again = await createStore(config);
        const resumed = createApp({ config, store: again });
        try {
          const me = await resumed.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) }));
          expect(me.status).toBe(200);
          const agents = await readJson<{ agents: { name: string; icon: string }[] }>(
            await resumed.fetch(new Request("http://localhost/api/agents", { headers: bearer(token) })),
          );
          expect(agents.agents.some((row) => row.name === "Research" && row.icon === "Search")).toBe(true);
          const messages = await readJson<{ messages: { content: string }[] }>(
            await resumed.fetch(
              new Request(`http://localhost/api/chats/${chat.chat.id}/messages`, { headers: bearer(token) }),
            ),
          );
          expect(messages.messages[0]?.content).toBe("Hello from postgres");
        } finally {
          await again.close();
        }
      } finally {
        await store.close();
      }
    },
    30_000,
  );
});
