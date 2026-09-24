import { describe, expect, test } from "bun:test";

import {
  createConfiguredRegistry,
  createRuntimeBridge,
  parseProfilesDocument,
  ProviderError,
  readProfilesOverride,
  selectProfiles,
} from "../src/index.ts";

const KEYS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

describe("profile catalog", () => {
  test("lists mock only when no provider key is set", () => {
    const profiles = selectProfiles(undefined, {});
    expect(profiles.map((profile) => profile.id)).toEqual(["mock"]);
    expect(profiles[0]?.provider).toBe("mock");
  });

  test("adds one profile per configured provider and never a default", () => {
    for (const [provider, envName] of Object.entries(KEYS)) {
      const profiles = selectProfiles(undefined, { [envName]: "secret" });
      expect(profiles.map((profile) => profile.id)).toEqual(["mock", provider]);
      expect(profiles.find((profile) => profile.id === provider)?.provider).toBe(
        provider as "openai" | "anthropic" | "xai" | "deepseek" | "openrouter",
      );
    }
    const anthropic = selectProfiles(undefined, { ANTHROPIC_API_KEY: "secret" });
    expect(anthropic.find((profile) => profile.id === "anthropic")?.maxTokens).toBe(4096);
  });

  test("ignores blank keys and lists openai-compat only when base URL and key are both set", () => {
    expect(selectProfiles(undefined, { OPENAI_API_KEY: "  " }).map((profile) => profile.id)).toEqual(["mock"]);
    expect(
      selectProfiles(undefined, { OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:11434/v1" }).map((profile) => profile.id),
    ).toEqual(["mock"]);
    expect(selectProfiles(undefined, { OPENAI_COMPAT_API_KEY: "local-key" }).map((profile) => profile.id)).toEqual([
      "mock",
    ]);

    const listed = selectProfiles(undefined, {
      OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:11434/v1",
      OPENAI_COMPAT_API_KEY: "local-key",
      OPENAI_COMPAT_MODEL: "llama3.1",
    });
    expect(listed.map((profile) => profile.id)).toEqual(["mock", "openai-compat"]);
    expect(listed[1]).toMatchObject({
      provider: "openai-compat",
      model: "llama3.1",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
  });

  test("accepts the legacy custom OpenAI env names", () => {
    const listed = selectProfiles(undefined, {
      CUSTOM_OPENAI_BASE_URL: "http://10.0.0.8:8000/v1",
      CUSTOM_OPENAI_API_KEY: "legacy",
    });
    expect(listed.find((profile) => profile.id === "openai-compat")?.baseUrl).toBe("http://10.0.0.8:8000/v1");
  });

  test("profiles.json replaces the built-in models and drops providers without keys", () => {
    const override = parseProfilesDocument({
      profiles: [
        { id: "fast", name: "Fast", provider: "deepseek", model: "deepseek-chat" },
        { id: "reason", provider: "anthropic", model: "claude-sonnet-4-5" },
        { id: "hidden", name: "Hidden", provider: "openai", model: "gpt-4.1" },
      ],
    });
    const profiles = selectProfiles(override, { DEEPSEEK_API_KEY: "ds", ANTHROPIC_API_KEY: "ant" });
    expect(profiles.map((profile) => profile.id)).toEqual(["mock", "fast", "reason"]);
    expect(profiles.find((profile) => profile.id === "reason")?.name).toBe("claude-sonnet-4-5");
    expect(profiles.find((profile) => profile.id === "reason")?.maxTokens).toBe(4096);
  });

  test("a models map expands to one profile per model", () => {
    const override = parseProfilesDocument({
      models: {
        openai: ["gpt-4.1", "gpt-4.1-mini"],
        xai: ["grok-4"],
      },
    });
    const profiles = selectProfiles(override, { OPENAI_API_KEY: "sk", XAI_API_KEY: "xk" });
    expect(profiles.map((profile) => `${profile.id}:${profile.model}`)).toEqual([
      "mock:echo",
      "openai-gpt-4-1:gpt-4.1",
      "openai-gpt-4-1-mini:gpt-4.1-mini",
      "xai:grok-4",
    ]);
  });

  test("rejects a default profile, inline keys, and duplicate ids", () => {
    expect(() => parseProfilesDocument({ defaultProfile: "openai", profiles: [] })).toThrow(/no default model/);
    expect(() =>
      parseProfilesDocument([{ id: "a", name: "A", provider: "openai", model: "gpt-4.1", apiKey: "sk-test" }]),
    ).toThrow(/API keys/);
    expect(() =>
      parseProfilesDocument([
        { id: "a", name: "A", provider: "openai", model: "gpt-4.1" },
        { id: "a", name: "B", provider: "openai", model: "gpt-4.1-mini" },
      ]),
    ).toThrow(ProviderError);
    expect(() =>
      selectProfiles(
        [{ id: "mock", name: "Nope", provider: "openai", model: "gpt-4.1", description: null }],
        { OPENAI_API_KEY: "sk" },
      ),
    ).toThrow(/reserved/);
  });

  test("reads a profiles file ahead of inline JSON", () => {
    const env = {
      BOTANICAL_PROFILES_FILE: "/tmp/profiles.json",
      BOTANICAL_PROFILES: JSON.stringify([{ id: "inline", name: "Inline", provider: "openai", model: "gpt-4.1" }]),
      OPENAI_API_KEY: "sk",
    };
    const raw = readProfilesOverride(env, () =>
      JSON.stringify({ profiles: [{ id: "from-file", name: "File", provider: "openai", model: "gpt-4.1" }] }),
    );
    const profiles = selectProfiles(parseProfilesDocument(raw), env);
    expect(profiles.map((profile) => profile.id)).toEqual(["mock", "from-file"]);
  });

  test("a missing or empty profiles file is a config error and a blank inline value is no override", () => {
    expect(() => readProfilesOverride({ BOTANICAL_PROFILES_FILE: "/missing.json" }, () => {
      throw new Error("enoent");
    })).toThrow(/could not be read/);
    expect(() => readProfilesOverride({ BOTANICAL_PROFILES_FILE: "/empty.json" }, () => "  ")).toThrow(/empty/);
    expect(readProfilesOverride({ BOTANICAL_PROFILES: "  " })).toBeUndefined();
    expect(readProfilesOverride({})).toBeUndefined();
  });

  test("the runtime bridge lists the same ids and does not invent a profile", async () => {
    const profiles = selectProfiles(undefined, { XAI_API_KEY: "xk" });
    const registry = createConfiguredRegistry(profiles, { env: { XAI_API_KEY: "xk" } });
    const bridge = createRuntimeBridge(registry);
    expect((await bridge.list()).map((profile) => profile.id)).toEqual(["mock", "xai"]);
    await expect(bridge.resolve("")).rejects.toMatchObject({ code: "PROFILE_REQUIRED" });
    await expect(bridge.resolve("missing")).rejects.toMatchObject({ code: "PROFILE_NOT_FOUND" });
  });
});
