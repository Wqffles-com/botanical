import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { createStore } from "../src/db/store.ts";
import { existsSync } from "node:fs";
import { baseEnv } from "./helpers.ts";

describe("loadConfig", () => {
  test("starts without a passcode", () => {
    const config = loadConfig({});
    expect(config.deploymentMode).toBe("SELF_HOST");
    expect(config.encryptionKey).toBeNull();
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
    expect(config.a2aAutorun).toBe(true);
  });

  test("A2A autorun can be disabled", () => {
    expect(loadConfig(baseEnv({ BOTANICAL_A2A_AUTORUN: "false" })).a2aAutorun).toBe(false);
    expect(() => loadConfig(baseEnv({ BOTANICAL_A2A_AUTORUN: "yes" }))).toThrow(/BOTANICAL_A2A_AUTORUN/);
  });

  test("public origin is optional and must be an origin", () => {
    const config = loadConfig(baseEnv());
    expect(config.publicOrigin).toBeNull();
    expect(loadConfig(baseEnv({ BOTANICAL_PUBLIC_ORIGIN: "http://localhost:3000" })).publicOrigin).toBe(
      "http://localhost:3000",
    );
    expect(() => loadConfig(baseEnv({ BOTANICAL_PUBLIC_ORIGIN: "http://localhost:3000/hooks" }))).toThrow(
      /BOTANICAL_PUBLIC_ORIGIN/,
    );
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
        OPENAI_COMPAT_API_KEY: "test-compat-key",
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
    expect(config.profiles.find((profile) => profile.id === "local")?.baseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(config.profiles.some((profile) => profile.id === "mock")).toBe(true);

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

  test("reads the encryption key and does not require a passcode", () => {
    const config = loadConfig(baseEnv({ BOTANICAL_ENCRYPTION_KEY: "test-encryption-key" }));
    expect(config.encryptionKey).toBe("test-encryption-key");
    expect(JSON.stringify(config)).not.toContain("test-encryption-key-nope");
    expect(() => loadConfig(baseEnv({ BOTANICAL_PASSWORD: "" }))).not.toThrow();
  });

  test("derives OpenAI speech-to-text when only OPENAI_API_KEY is set", () => {
    const config = loadConfig(baseEnv({ OPENAI_API_KEY: "sk-openai-test" }));
    expect(config.dictation).toEqual({
      mode: "server",
      provider: "openai-compat",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai-test",
      model: "gpt-4o-mini-transcribe",
      maxBytes: 10_000_000,
      maxSeconds: 120,
    });
    expect(loadConfig(baseEnv()).dictation.mode).toBe("browser");
    const custom = loadConfig(baseEnv({ BOTANICAL_STT_BASE_URL: "https://api.groq.com/openai/v1" }));
    expect(custom.dictation.mode).toBe("server");
    if (custom.dictation.mode !== "server") return;
    expect(custom.dictation.model).toBe("whisper-1");
    expect(custom.dictation.apiKey).toBeNull();
    expect(custom.dictation.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  test("rejects a bad database URL", () => {
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
