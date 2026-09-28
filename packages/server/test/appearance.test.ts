import { describe, expect, test } from "bun:test";
import type { App } from "../src/app.ts";
import { bearer, login, readJson, setup } from "./helpers.ts";

function patchJson(app: App, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("appearance", () => {
  test("defaults to neutral and stores a per-user accent", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const headers = bearer(token);

    const initial = await readJson<{ accent: string }>(
      await app.fetch(new Request("http://localhost/api/settings/appearance", { headers })),
    );
    expect(initial.accent).toBe("neutral");

    const saved = await readJson<{ accent: string }>(
      await patchJson(app, "/api/settings/appearance", { accent: "violet" }, headers),
    );
    expect(saved.accent).toBe("violet");

    const again = await readJson<{ accent: string }>(
      await app.fetch(new Request("http://localhost/api/settings/appearance", { headers })),
    );
    expect(again.accent).toBe("violet");

    const cleared = await readJson<{ accent: string }>(
      await patchJson(app, "/api/settings/appearance", { accent: "neutral" }, headers),
    );
    expect(cleared.accent).toBe("neutral");
  });

  test("rejects an unknown accent and anonymous reads", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const bad = await patchJson(app, "/api/settings/appearance", { accent: "lime" }, bearer(token));
    expect(bad.status).toBe(400);
    const anon = await app.fetch(new Request("http://localhost/api/settings/appearance"));
    expect(anon.status).toBe(401);
  });
});

describe("bot customization", () => {
  test("stores title, shape, and picture, and clears the picture", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const headers = bearer(token);
    const picture = `data:image/png;base64,${"A".repeat(80)}`;
    const created = await app.fetch(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          name: "Fern",
          title: "Plot keeper",
          prompt: "Tend the beds.",
          shape: "hexagon",
          picture,
          color: "green",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const agent = (await readJson<{ agent: { id: string; title: string; shape: string; picture: string | null } }>(created)).agent;
    expect(agent).toMatchObject({ title: "Plot keeper", shape: "hexagon", picture });

    const cleared = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ picture: null, shape: "shield" }),
      }),
    );
    expect(cleared.status).toBe(200);
    const next = (await readJson<{ agent: { title: string; shape: string; picture: string | null } }>(cleared)).agent;
    expect(next).toMatchObject({ title: "Plot keeper", shape: "shield", picture: null });

    const badShape = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ shape: "triangle" }),
      }),
    );
    expect(badShape.status).toBe(400);

    const badPicture = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ picture: "https://example.com/a.png" }),
      }),
    );
    expect(badPicture.status).toBe(400);
  });
});
