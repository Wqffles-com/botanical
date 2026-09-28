# End-to-end tests

[Index](README.md)

Browser tests for the web app. They are not part of CI. Do not run them against a live stack unless that was explicitly requested.

- Package: `@botanical/e2e`
- Config: `packages/e2e/playwright.config.ts`
- Runner: `scripts/e2e/run.mjs` (root scripts `e2e` and `e2e:self-test`; package script `test` calls the same file)

## Files

| Path | Purpose |
|------|---------|
| `packages/e2e/tests/auth.spec.ts` | Wrong passcode, anonymous redirect to `/login` |
| `packages/e2e/tests/mvp.spec.ts` | Signed-in MVP path |
| `packages/e2e/src/ui.ts` | Login helpers |
| `packages/e2e/src/env.ts` | Passcode lookup |
| `packages/e2e/src/contract.ts` | Shared response checks |
| `packages/e2e/playwright.config.ts` | One Chromium worker, `BASE_URL` |
| `scripts/e2e/run.mjs` | Probes the target, or starts a fixture with `--self-test` |
| `scripts/e2e/fixture-server.mjs` | In-process stand-in used by `--self-test` |
| `scripts/e2e/fixture.html` | Fixture page |

Default `BASE_URL` is `http://localhost:3000`. Without `--self-test` the runner only checks that the URL accepts connections; it does not boot compose. `--self-test` (`bun run e2e:self-test`) starts `scripts/e2e/fixture-server.mjs` and tears it down.

Root `bun run test` includes this package because the workspace `test` script points at `scripts/e2e/run.mjs`. The CI loop in `.github/workflows/ci.yml` does not.

A separate smoke harness (mock API, not this package) lives in `scripts/smoke`.

## Env vars

| File | Names |
|------|--------|
| `packages/e2e/src/env.ts` | `BOTANICAL_PASSCODE`, `BOTANICAL_PASSWORD`, `E2E_PASSCODE` |
| `packages/e2e/playwright.config.ts` | `BASE_URL`, `CI` |
| `scripts/e2e/run.mjs` | Those, plus `PLAYWRIGHT_BROWSERS_PATH` |

## How to run

Only when asked: `bun run e2e` against an already running web origin, or `bun run e2e:self-test` for the fixture. Package scripts: `test`, `test:self`, `test:list`, `typecheck`.

## Where to change X

- **Add a browser scenario.** New spec under `packages/e2e/tests`, helpers in `packages/e2e/src/ui.ts`.
- **Change the login secret the suite types.** `packages/e2e/src/env.ts`.
- **Change the fixture (no live stack).** `scripts/e2e/fixture-server.mjs`.
