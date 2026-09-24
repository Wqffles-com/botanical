# `@botanical/providers`

Streaming model adapters for the Botanical server.

OpenAI Chat Completions is the lingua franca. GPT, Grok, DeepSeek, OpenRouter, and any other OpenAI-compatible host share that client. Claude uses the Anthropic Messages API behind the same `ChatEvent` stream. The server should import this package and not talk to vendor SDKs itself.

Works the same for a self-hosted server and a hosted deployment. API keys are read from the server environment only.

## Contract

Every completion takes a `profileId`. There is no default profile and no default model. `createRegistry` rejects `defaultProfile`. `complete` throws `ProfileRequiredError` when `profileId` is missing or blank, and `UnknownProfileError` when it is unknown. Those errors are thrown before any network call.

```ts
import { builtinProviderConfigs, createRegistry } from "@botanical/providers";

const providers = createRegistry({
  providers: builtinProviderConfigs(),
  profiles: [
    { id: "fast", provider: "deepseek", model: "deepseek-chat" },
    { id: "reason", provider: "anthropic", model: "claude-sonnet-4-5", maxTokens: 4096 },
    { id: "grok", provider: "xai", model: "grok-4" },
    { id: "router", provider: "openrouter", model: "openrouter/auto" },
  ],
});

// profileId comes from the user. Do not substitute one when it is absent.
for await (const event of providers.complete({
  profileId,
  messages: [{ role: "user", content: "Hello" }],
})) {
  // text-delta | reasoning-delta | tool-call | usage | error | done
}
```

`resolve(input)` checks the profile, model, and server env key without calling the vendor. `listProviders()` reports `keyConfigured` and the env var name, never the key.

Config and request objects reject an inline `apiKey`. Hosted providers read these variables:

| Provider | Type | Env | Default base URL |
| --- | --- | --- | --- |
| OpenAI GPT | `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| xAI Grok | `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| Custom host | `openai-compat` | optional `apiKeyEnv` | required `baseURL` |
| Tests | `mock` | none | none |

Model ids live on profiles. The samples above are examples, not a built-in choice. Profile and provider ids are URL-safe slugs: letters, numbers, and `.` `_` `:` `-`.

## Adapter notes

- **OpenAI.** `POST /chat/completions` with `stream: true` and `stream_options.include_usage`. Output limit is sent as `max_completion_tokens` (`max_tokens` is deprecated and rejected by o-series models).
- **xAI.** Same chat-completions client at `https://api.x.ai/v1/chat/completions`. Bearer `XAI_API_KEY`. Output limit stays `max_tokens`. `reasoning_content` deltas become `reasoning-delta`. The Responses API is not used.
- **DeepSeek.** `https://api.deepseek.com/chat/completions` (the `/v1` alias also works if you set `baseURL`). `reasoning_content` on reasoner models becomes `reasoning-delta`.
- **OpenRouter.** OpenAI-compatible, plus optional `HTTP-Referer`, `X-Title`, and `routing` (`order`, `allowFallbacks`, `only`, `ignore`) sent as the `provider` body field. `reasoning_details[].text` becomes `reasoning-delta`.
- **Anthropic.** `POST /v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`. System messages are lifted to top-level `system`. Tool results are `tool_result` blocks and consecutive tool turns are merged. `thinking_delta` becomes `reasoning-delta`. `maxTokens` is required on the profile or the request because the API rejects a missing `max_tokens`. The base URL is the origin (`https://api.anthropic.com`), not a `/v1` prefix.
- **openai-compat.** Set `baseURL` to a local or proxied `/v1` origin. Omit `apiKeyEnv` to send no `Authorization` header. Set `includeUsage: false` if the host rejects `stream_options`.
- Redirects are refused so a key is not forwarded to another host. Error text is redacted if it echoes the key.

`ChatEvent` of type `error` is emitted only after partial output. Setup failures, HTTP errors, and aborts throw. A caller abort rejects with `AbortError`. `done` means the stream finished without a thrown error.

Capability fields are hints for policy (tools, vision, context). Override them per model with `capabilities` on the provider config.

## Mock provider

```ts
const providers = createRegistry({
  providers: [{
    id: "mock",
    type: "mock",
    mock: { reply: "hello", chunkSize: 4 },
  }],
  profiles: [{ id: "test", provider: "mock", model: "mock-1" }],
});
```

`mock.events` replays a script of `ChatEvent`s (a terminal `done` is added if you omit one). `createMockProvider()` records `calls` for assertions. The mock never reads the environment and never calls the network.

## Server catalog

`selectProfiles(override, env)` builds the list behind `GET /api/profiles`.

- `mock` is always included.
- With no override, one profile is added for each configured key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`.
- `openai-compat` is added only when both `OPENAI_COMPAT_BASE_URL` and `OPENAI_COMPAT_API_KEY` are set. `OPENAI_COMPAT_MODEL` sets that profile's model id. `CUSTOM_OPENAI_BASE_URL` and `CUSTOM_OPENAI_API_KEY` are legacy aliases used when the canonical name is unset.
- `BOTANICAL_PROFILES_FILE` (a `profiles.json` document) replaces that built-in list. `BOTANICAL_PROFILES` is the inline form and is ignored when the file is set. Profiles whose provider key is missing are omitted. `defaultProfile` is rejected.
- The document may be a profile array, `{ "profiles": [...] }`, or `{ "models": { "openai": ["gpt-4.1", "gpt-4.1-mini"] } }`.

Nothing in that list is selected for the caller. `createRuntimeBridge(registry)` is the `ProfileResolver` shape from `packages/agent-runtime` (`resolve` / `list`, and `LLMProvider.complete`). Blank `profileId` throws `PROFILE_REQUIRED`. Unknown ids throw `PROFILE_NOT_FOUND`. `reasoning-delta` is omitted so the runtime loop can switch on `text-delta` and `tool-call`. `capabilities()` omits `reasoning`.

```ts
import { createConfiguredRegistry, createRuntimeBridge, selectProfiles } from "@botanical/providers";

const profiles = selectProfiles(undefined, process.env);
const registry = createConfiguredRegistry(profiles, { env: process.env });
const resolver = createRuntimeBridge(registry);
// deps.profiles in runAgentTurn
```

The HTTP server still runs the mock profile through the deterministic `file_list` turn. The bridge's mock provider only echoes.

## Develop

```sh
cd packages/providers
bun install
bun test
bun run typecheck
```

The server registers this package when the workspace root exists. Source is the runtime entry (`exports` points at `src/index.ts`) for Bun.
