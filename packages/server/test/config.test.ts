import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/config.ts";
import { createStore } from "../src/db/store.ts";
import { existsSync } from "node:fs";
import { baseEnv } from "./helpers.ts";

describe("loadConfig", () => {
  test("requires a password", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  test("rejects an unknown deployment mode", () => {
    expect(() => loadConfig(baseEnv({ BOTANICAL_DEPLOYMENT_MODE: "hosted" }))).toThrow(
      /SELF_HOST or SAAS/,
    );
  });

  test("defaults to self-host branding", () => {
    const config = loadConfig(baseEnv());
    expect(config.deploymentMode).toBe("SELF_HOST");
    expect(config.brandName).toBe("Botanical");
    expect(config.databaseUrl).toBeUndefined();
  });

  test("saas mode changes the default brand only", () => {
    const config = loadConfig(baseEnv({ BOTANICAL_DEPLOYMENT_MODE: "SAAS" }));
    expect(config.deploymentMode).toBe("SAAS");
    expect(config.brandName).toBe("Botanical Cloud");
  });

  test("brand name overrides either mode", () => {
    const config = loadConfig(
      baseEnv({ BOTANICAL_DEPLOYMENT_MODE: "SAAS", BOTANICAL_BRAND_NAME: "Garden" }),
    );
    expect(config.brandName).toBe("Garden");
  });

  test("rejects profile API keys and duplicate ids", () => {
    expect(() =>
      loadConfig(
        baseEnv({
          BOTANICAL_PROFILES: JSON.stringify([
            { id: "a", name: "A", provider: "openai", model: "gpt", apiKey: "sk-test" },
          ]),
        }),
      ),
    ).toThrow(/API keys/);

    expect(() =>
      loadConfig(
        baseEnv({
          BOTANICAL_PROFILES: JSON.stringify([
            { id: "grok", name: "A", provider: "xai", model: "grok-4" },
            { id: "grok", name: "B", provider: "xai", model: "grok-4" },
          ]),
        }),
      ),
    ).toThrow(/Duplicate model profile/);
  });

  test("accepts an openai-compat base URL and rejects embedded credentials", () => {
    const config = loadConfig(
      baseEnv({
        BOTANICAL_PROFILES: JSON.stringify([
          {
            id: "local",
            name: "Local",
            provider: "openai-compat",
            model: "llama",
            baseUrl: "http://127.0.0.1:11434/v1",
          },
        ]),
      }),
    );
    expect(config.profiles[0]?.baseUrl).toBe("http://127.0.0.1:11434/v1");

    expect(() =>
      loadConfig(
        baseEnv({
          BOTANICAL_PROFILES: JSON.stringify([
            {
              id: "local",
              name: "Local",
              provider: "openai-compat",
              model: "llama",
              baseUrl: "http://user:secret@127.0.0.1:11434/v1",
            },
          ]),
        }),
      ),
    ).toThrow(/credentials/);
  });

  test("argon2 hash takes precedence and the plaintext is dropped", async () => {
    const hash = await Bun.password.hash("hash-secret");
    const config = loadConfig(
      baseEnv({
        BOTANICAL_PASSWORD: "plain-secret",
        BOTANICAL_PASSWORD_HASH: hash,
      }),
    );
    expect(config.auth).toEqual({ method: "hash", hash });
    expect(JSON.stringify(config.auth)).not.toContain("plain-secret");
  });

  test("rejects a non-argon2 hash and a bad database URL", () => {
    expect(() => loadConfig(baseEnv({ BOTANICAL_PASSWORD_HASH: "sha256:nope" }))).toThrow(
      /argon2/,
    );
    expect(() => loadConfig(baseEnv({ DATABASE_URL: "mysql://localhost/botanical" }))).toThrow(
      /postgres/,
    );
  });
});

describe("createStore", () => {
  test("uses memory when DATABASE_URL is unset", async () => {
    const store = await createStore(loadConfig(baseEnv()));
    expect(store.kind).toBe("memory");
    const seeded = await store.agents.list();
    expect(seeded.map((agent) => agent.name)).toEqual(["Gardener", "Builder", "Scout"]);
    expect(seeded.map((agent) => [agent.icon, agent.color])).toEqual([
      ["Sprout", "green"],
      ["Code", "blue"],
      ["Search", "amber"],
    ]);
  });

  test("fails closed when DATABASE_URL is set and packages/db is absent", async () => {
    const dbRoot = new URL("../../db/", import.meta.url);
    if (existsSync(dbRoot)) return;
    await expect(
      createStore(
        loadConfig(
          baseEnv({ DATABASE_URL: "postgres://botanical:botanical@127.0.0.1:5432/botanical" }),
        ),
      ),
    ).rejects.toThrow(/packages\/db/);
  });
});
