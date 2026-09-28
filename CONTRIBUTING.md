# Contributing to Botanical

Thanks for your interest! Botanical is an early-alpha project, so things move quickly and APIs can change. Contributions of all sizes are welcome: bug reports, docs, tests, and code.

By participating you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before you start

- **Bugs and small fixes:** open a pull request directly, or an issue first if you're unsure.
- **Features and larger changes:** please open an issue to discuss the approach before writing a lot of code. Check [docs/DECISIONS.md](./docs/DECISIONS.md) and [docs/ROADMAP.md](./docs/ROADMAP.md) first; some choices (no default model, server-side keys only, one agent per chat) are deliberate.
- **Security issues:** do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Development setup

Requirements: [Bun](https://bun.sh) 1.2+ (the repo pins `bun@1.4.2`), Node.js 20+ for the Next.js web app and Playwright, and optionally Docker and Postgres.

```sh
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
bun install
export BOTANICAL_PASSWORD=dev-passcode
bun run dev          # API on :8787, web on :3000 (in-memory store unless DATABASE_URL is set)
```

For Postgres, set `DATABASE_URL` and run `bun run db:migrate`, or use `docker compose up` (see [docs/DEPLOY.md](./docs/DEPLOY.md)).

## Checks

Run these before opening a PR. CI runs the typecheck and unit tests, then builds and smoke-tests the release zip.

```sh
bun run typecheck
bun run test
```

The `shell` / `code_exec` tests need unprivileged user namespaces (`unshare`). On Ubuntu 24.04 you may need `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; otherwise the sandbox tests skip or fail. Postgres integration tests run only when `BOTANICAL_TEST_DATABASE_URL` is set. Browser tests (`bun run e2e`) need a running stack. See [docs/TESTING.md](./docs/TESTING.md).

## Project layout

Packages live under `packages/`. See the table in the [README](./README.md#architecture) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). A file-level map for coding agents is [docs/index/README.md](./docs/index/README.md), and agent instructions are in [AGENTS.md](./AGENTS.md). If a change adds, moves, renames, or deletes files, routes, tables, env vars, or packages, update `docs/index/` in the same PR and run `bun run check:index`. A key rule: only `packages/providers` talks to model vendors. The agent runtime and tools never import a vendor SDK.

## Pull requests

- Keep PRs focused, one topic per PR, and describe what changed and why.
- Add or update tests for behavior changes.
- Update docs (README, `docs/`, package READMEs) when you change configuration, APIs, or behavior. Record significant design choices in `docs/DECISIONS.md`.
- Never commit secrets, `.env` files, or real API keys. Use obvious placeholders in examples and tests.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
