# Providers

[Index](README.md)

Streaming model adapters and headless coding-CLI profiles. This is the only package that speaks vendor protocols.

- Package: `@botanical/providers`
- Entry: `packages/providers/src/index.ts`

## Files

| Path | Purpose |
|------|---------|
| `packages/providers/src/types.ts` | `PROVIDER_TYPES`, chat and tool types |
| `packages/providers/src/registry.ts` | `createRegistry`, `builtinProviderConfigs`, `PROVIDER_BASE_URLS` |
| `packages/providers/src/catalog.ts` | Which profiles are listed from env and `BOTANICAL_PROFILES` |
| `packages/providers/src/env.ts` | `CANONICAL_API_KEY_ENVS`, `resolveApiKey` |
| `packages/providers/src/openai-client.ts` | OpenAI-compatible chat-completions stream |
| `packages/providers/src/anthropic.ts` | Messages stream for type `anthropic` |
| `packages/providers/src/sse.ts` | SSE parser for provider HTTP |
| `packages/providers/src/mock.ts` | `createMockProvider` |
| `packages/providers/src/runtime.ts` | Bridge into the agent-runtime provider shape |
| `packages/providers/src/capabilities.ts` | Per-model capability flags |
| `packages/providers/src/collect.ts` | `collectChat` test helper |
| `packages/providers/src/cli` | Install, login, args, and `runCli` for CLI profiles. `runCli` `input` writes mid-turn messages to Claude Code's stream-json stdin |
| `packages/providers/test` | `bun test` |

Provider type ids: `openai`, `anthropic`, `xai`, `deepseek`, `openrouter`, `openai-compat`, `mock`. CLI names in `packages/providers/src/cli/types.ts`: `grok`, `claude`, `codex`. Preset profile ids: `grok-build`, `claude-code`, `codex`.

`xai`, `deepseek`, `openrouter`, and `openai-compat` use `packages/providers/src/openai-client.ts`. `anthropic` uses `packages/providers/src/anthropic.ts`.

## Exports

`createRegistry`, `builtinProviderConfigs`, `parseProfilesDocument`, `selectProfiles`, `readProfilesOverride`, `mergeCliProfiles`, `parseCliProfileShortcut`, `createRuntimeBridge`, `resolveApiKey`, `runCli`, `CliInstaller`, `LoginManager`, `createMockProvider`.

## Env vars

| File | Names |
|------|--------|
| `packages/providers/src/env.ts` | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` |
| `packages/providers/src/catalog.ts` | `BOTANICAL_PROFILES`, `BOTANICAL_PROFILES_FILE`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL`, `CUSTOM_OPENAI_BASE_URL`, `CUSTOM_OPENAI_API_KEY` |
| `packages/providers/src/cli/install.ts` | `BOTANICAL_CLI_BIN`, `BOTANICAL_CLI_HOME`, `BOTANICAL_CLI_CACHE`, `HOME`, `BOTANICAL_GROK_VERSION`, `BOTANICAL_CLAUDE_VERSION`, `BOTANICAL_CODEX_VERSION` |
| `packages/providers/src/cli/availability.ts` | `BOTANICAL_CLI_BIN`, `BOTANICAL_CLI_HOME`, `HOME`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY` |
| `packages/providers/src/cli/launch.ts` | `BOTANICAL_MCP_TOKEN` (set on the child, not operator config) |
| `packages/providers/src/cli/child-env.ts` | Pass-through allowlist includes `CODEX_API_KEY` for `codex`; strips secrets such as `DATABASE_URL` and `BOTANICAL_PASSWORD` |

`BOTANICAL_CLI_PROFILES` is parsed here but read by `packages/server/src/config.ts` before `mergeCliProfiles`. Example profile JSON: `profiles.example.json`.

## Tests

`packages/providers/test`. Script: `bun test`. Fixture binary: `packages/providers/test/fixtures/fake-cli.ts`.

## Where to change X

- **Add a hosted provider.** Extend `PROVIDER_TYPES` in `packages/providers/src/types.ts`. Add a base URL in `PROVIDER_BASE_URLS` / `defaultBaseURL` in `packages/providers/src/registry.ts`. Reuse `packages/providers/src/openai-client.ts` when the API is chat-completions; otherwise add a stream module next to `packages/providers/src/anthropic.ts` and branch in `buildProvider`. Add the key name to `packages/providers/src/env.ts` and a row in `builtinProviderConfigs`. Teach `packages/providers/src/catalog.ts` when the key should list profiles. Add a test under `packages/providers/test`.
- **Add a CLI profile preset.** `packages/providers/src/cli/types.ts`, install/launch in `packages/providers/src/cli`, and the shortcut parser in `packages/providers/src/cli/config.ts`.
- **Change which profiles exist.** Operator JSON in `BOTANICAL_PROFILES` or `BOTANICAL_PROFILES_FILE`. Code path: `packages/providers/src/catalog.ts`.
