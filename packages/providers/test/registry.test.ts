import { describe, expect, test } from "bun:test";
import { collectChat } from "../src/collect.ts";
import {
  MissingApiKeyError,
  ProfileRequiredError,
  ProviderError,
  UnknownProfileError,
} from "../src/errors.ts";
import { builtinProviderConfigs, createRegistry } from "../src/registry.ts";
import { captureFetch, dataEvents, header, jsonBody, sseResponse } from "./helpers.ts";

const ok = sseResponse([
  dataEvents([
    JSON.stringify({ choices: [{ delta: { content: "ok" } }] }),
    "[DONE]",
  ]),
]);

function hostedConfig() {
  return {
    providers: [
      ...builtinProviderConfigs(),
      { id: "local", type: "openai-compat", baseURL: "http://127.0.0.1:11434/v1", includeUsage: false },
      { id: "mock", type: "mock", mock: { reply: "mocked", chunkSize: 3 } },
    ],
    profiles: [
      { id: "fast", provider: "deepseek", model: "deepseek-chat", temperature: 0 },
      { id: "reason", provider: "anthropic", model: "claude-sonnet-4-5", maxTokens: 32 },
      { id: "grok", provider: "xai", model: "grok-4", maxTokens: 16 },
      { id: "router", provider: "openrouter", model: "openrouter/auto" },
      { id: "local", provider: "local", model: "llama" },
      { id: "mock", provider: "mock", model: "mock-1" },
    ],
  };
}

describe("profiles", () => {
  test("rejects a default profile and an inline api key", () => {
    expect(() =>
      createRegistry({
        defaultProfile: "fast",
        providers: [{ id: "openai", type: "openai" }],
        profiles: [{ id: "fast", provider: "openai", model: "gpt-4.1" }],
      }),
    ).toThrow(/defaultProfile/);

    expect(() =>
      createRegistry({
        providers: [{ id: "openai", type: "openai", apiKey: "sk-live" }],
        profiles: [{ id: "fast", provider: "openai", model: "gpt-4.1" }],
      }),
    ).toThrow(/Inline apiKey/);
  });

  test("requires profileId and does not fall back to another profile", () => {
    const captured = captureFetch(ok);
    const registry = createRegistry(hostedConfig(), {
      env: { DEEPSEEK_API_KEY: "sk-ds" },
      fetch: captured.fetch,
    });

    expect(() =>
      registry.complete({ profileId: "", messages: [{ role: "user", content: "hi" }] }),
    ).toThrow(ProfileRequiredError);
    expect(() =>
      registry.complete({ profileId: "   ", messages: [{ role: "user", content: "hi" }] }),
    ).toThrow(ProfileRequiredError);
    expect(() =>
      registry.complete({
        profileId: undefined as unknown as string,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(ProfileRequiredError);
    expect(() =>
      registry.complete({ profileId: "missing", messages: [{ role: "user", content: "hi" }] }),
    ).toThrow(UnknownProfileError);
    expect(captured.calls).toHaveLength(0);
    expect(registry.listProfiles().map((profile) => profile.id)).toEqual([
      "fast",
      "reason",
      "grok",
      "router",
      "local",
      "mock",
    ]);
    expect("defaultProfile" in registry).toBe(false);
  });

  test("reads keys from the provided env only and reports configuration without the secret", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-process";
    try {
      const captured = captureFetch(ok);
      const registry = createRegistry(
        {
          providers: [{ id: "openai", type: "openai" }, { id: "mock", type: "mock" }],
          profiles: [
            { id: "chat", provider: "openai", model: "gpt-4.1" },
            { id: "mock", provider: "mock", model: "mock-1" },
          ],
        },
        { env: {}, fetch: captured.fetch },
      );
      expect(() =>
        registry.complete({ profileId: "chat", messages: [{ role: "user", content: "hi" }] }),
      ).toThrow(MissingApiKeyError);
      expect(captured.calls).toHaveLength(0);
      const openai = registry.listProviders().find((provider) => provider.id === "openai");
      expect(openai).toEqual({ id: "openai", type: "openai", keyConfigured: false, apiKeyEnv: "OPENAI_API_KEY" });
      expect(JSON.stringify(registry.listProviders())).not.toContain("sk-from-process");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  test("refuses an api key passed on the completion", () => {
    const registry = createRegistry(
      {
        providers: [{ id: "mock", type: "mock" }],
        profiles: [{ id: "mock", provider: "mock", model: "mock-1" }],
      },
      { env: {} },
    );
    expect(() =>
      registry.complete({
        profileId: "mock",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk-nope",
      } as never),
    ).toThrow(/server environment/);
  });

  test("uses an explicit model override and profile sampling defaults", async () => {
    const captured = captureFetch(ok);
    const registry = createRegistry(hostedConfig(), {
      env: { DEEPSEEK_API_KEY: "sk-ds", XAI_API_KEY: "sk-xai" },
      fetch: captured.fetch,
    });
    await collectChat(
      registry.complete({
        profileId: "fast",
        model: "deepseek-reasoner",
        messages: [{ role: "user", content: "why" }],
        maxTokens: 9,
      }),
    );
    const body = jsonBody(captured.calls[0]?.init);
    expect(captured.calls[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(header(captured.calls[0]?.init, "authorization")).toBe("Bearer sk-ds");
    expect(body.model).toBe("deepseek-reasoner");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(9);
    expect(body.max_completion_tokens).toBeUndefined();
  });
});

describe("first-class providers", () => {
  test("Grok, OpenRouter, and a local compatible host", async () => {
    const captured = captureFetch(ok);
    const registry = createRegistry(
      {
        providers: [
          { id: "xai", type: "xai", baseURL: "https://proxy.example/v1" },
          {
            id: "openrouter",
            type: "openrouter",
            httpReferer: "https://botanical.example",
            appTitle: "Botanical",
            routing: { order: ["xai"], allowFallbacks: true },
          },
          { id: "local", type: "openai-compat", baseURL: "http://127.0.0.1:11434/v1", includeUsage: false },
        ],
        profiles: [
          { id: "grok", provider: "xai", model: "grok-4" },
          { id: "router", provider: "openrouter", model: "openrouter/auto" },
          { id: "local", provider: "local", model: "llama" },
        ],
      },
      { env: { XAI_API_KEY: "sk-xai", OPENROUTER_API_KEY: "sk-or" }, fetch: captured.fetch },
    );

    await collectChat(registry.complete({ profileId: "grok", messages: [{ role: "user", content: "hi" }] }));
    expect(captured.calls[0]?.url).toBe("https://proxy.example/v1/chat/completions");
    expect(header(captured.calls[0]?.init, "authorization")).toBe("Bearer sk-xai");

    await collectChat(registry.complete({ profileId: "router", messages: [{ role: "user", content: "hi" }] }));
    expect(captured.calls[1]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(header(captured.calls[1]?.init, "HTTP-Referer")).toBe("https://botanical.example");
    expect(header(captured.calls[1]?.init, "X-Title")).toBe("Botanical");
    expect(jsonBody(captured.calls[1]?.init).provider).toEqual({ order: ["xai"], allow_fallbacks: true });

    await collectChat(registry.complete({ profileId: "local", messages: [{ role: "user", content: "hi" }] }));
    expect(captured.calls[2]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(header(captured.calls[2]?.init, "authorization")).toBeUndefined();
    expect(jsonBody(captured.calls[2]?.init).stream_options).toBeUndefined();
  });

  test("maps OpenRouter reasoning details", async () => {
    const stream = sseResponse([
      dataEvents([
        JSON.stringify({
          choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "step" }] } }],
        }),
        JSON.stringify({ choices: [{ delta: { content: "answer" } }] }),
        "[DONE]",
      ]),
    ]);
    const captured = captureFetch(stream);
    const registry = createRegistry(
      {
        providers: [{ id: "openrouter", type: "openrouter" }],
        profiles: [{ id: "router", provider: "openrouter", model: "openrouter/auto" }],
      },
      { env: { OPENROUTER_API_KEY: "sk-or" }, fetch: captured.fetch },
    );
    const result = await collectChat(
      registry.complete({ profileId: "router", messages: [{ role: "user", content: "hi" }] }),
    );
    expect(result.reasoning).toBe("step");
    expect(result.text).toBe("answer");
  });

  test("authorization headers cannot be smuggled through provider config", () => {
    expect(() =>
      createRegistry({
        providers: [{ id: "openai", type: "openai", defaultHeaders: { Authorization: "Bearer sk-smuggled" } }],
        profiles: [{ id: "chat", provider: "openai", model: "gpt-4.1" }],
      }),
    ).toThrow(/server environment/);
  });

  test("aborts when the caller signal is already aborted", async () => {
    const captured = captureFetch(ok);
    const registry = createRegistry(
      {
        providers: [{ id: "openai", type: "openai" }],
        profiles: [{ id: "chat", provider: "openai", model: "gpt-4.1" }],
      },
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: captured.fetch },
    );
    const signal = AbortSignal.abort();
    await expect(
      collectChat(
        registry.complete({
          profileId: "chat",
          messages: [{ role: "user", content: "hi" }],
          signal,
        }),
      ),
    ).rejects.toThrow();
    expect(captured.calls).toHaveLength(0);
  });
});
