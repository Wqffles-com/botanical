import { createApp, type App } from "../src/app.ts";
import { LoginRateLimiter } from "../src/auth/rate-limit.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import type { ProviderFetch } from "../src/provider-host.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import type { Store } from "../src/types.ts";

export const PASSWORD = "correct horse";

export const PROFILES = [
  { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
  { id: "fast", name: "Fast", provider: "deepseek", model: "deepseek-chat" },
] as const;

export interface TestApp {
  app: App;
  config: ServerConfig;
  store: Store;
}

export function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    BOTANICAL_PASSWORD: PASSWORD,
    BOTANICAL_PROFILES: JSON.stringify(PROFILES),
    XAI_API_KEY: "test-xai-key",
    DEEPSEEK_API_KEY: "test-deepseek-key",
    ...overrides,
  };
}

/** OpenAI-style SSE so profile tests never call a vendor. */
export function defaultProviderFetch(input: Request | URL | string, init?: RequestInit): Promise<Response> {
  void input;
  let model = "model";
  if (typeof init?.body === "string") {
    try {
      const parsed = JSON.parse(init.body) as { model?: unknown };
      if (typeof parsed.model === "string" && parsed.model.trim() !== "") model = parsed.model;
    } catch {
      // The provider client always sends JSON. A bad body still gets a harmless reply.
    }
  }
  const text = `Reply from ${model}`;
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return Promise.resolve(
    new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  );
}

export function setup(
  overrides: Record<string, string> = {},
  options: { now?: () => Date; rateLimiter?: LoginRateLimiter; fetch?: ProviderFetch } = {},
): TestApp {
  const config = loadConfig(baseEnv(overrides), { fetch: options.fetch ?? defaultProviderFetch });
  const store = createMemoryStore();
  const app = createApp({
    config,
    store,
    now: options.now,
    rateLimiter: options.rateLimiter,
  });
  return { app, config, store };
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function login(
  app: App,
  password = PASSWORD,
  extras?: { clientKey?: string; body?: Record<string, unknown> },
): Promise<{ response: Response; token: string; expiresAt: string }> {
  const response = await app.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(extras?.body ?? { password }),
    }),
    extras?.clientKey ? { clientKey: extras.clientKey } : undefined,
  );
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${await response.clone().text()}`);
  }
  const body = await readJson<{ token: string; expiresAt: string }>(response);
  return { response, token: body.token, expiresAt: body.expiresAt };
}

export async function createAgent(
  app: App,
  token: string,
  input: { name?: string; description?: string; systemPrompt?: string; toolIds?: string[] } = {},
): Promise<{ id: string; name: string; systemPrompt: string; toolIds: string[] }> {
  const response = await app.fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({
        name: input.name ?? "Gardener",
        description: input.description ?? "Tends the plots",
        systemPrompt: input.systemPrompt ?? "You keep the garden.",
        toolIds: input.toolIds ?? ["web.search"],
      }),
    }),
  );
  if (response.status !== 201) {
    throw new Error(`create agent failed: ${response.status} ${await response.text()}`);
  }
  const body = await readJson<{ agent: { id: string; name: string; systemPrompt: string; toolIds: string[] } }>(
    response,
  );
  return body.agent;
}
