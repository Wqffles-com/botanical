# Botanical: deployment modes

One MIT codebase, two deployment modes: **self-host** and **hosted (SaaS)**. Neither mode charges anyone today.

> **Which setting does what.** The running API server (`packages/server`) reads `BOTANICAL_DEPLOYMENT_MODE` = `SELF_HOST` | `SAAS`. The Docker entrypoint fills it in from `DEPLOYMENT_MODE` and accepts `self_host` / `saas` in any case. Both modes share routes, email/password accounts, and storage. SaaS mode changes the brand name. Signup mode (open, invite-only, or closed) is an admin setting in the database. The `@botanical/core` deployment module below is an unused seam for future tenancy and billing. It still models a single passcode and a `sha256:` hash. The API server does not call it.

## The split (as modeled in `@botanical/core`)

| | Self-host (open source) | Hosted (SaaS) |
|--|-------------------------|---------------|
| Code license | **MIT** — use, modify, redistribute | **Same MIT code**. A subscription would pay for running that code as a service, not for a separate license |
| Mode | `self-host` (default) | `saas` |
| Who runs it | You, on any host | The Botanical project, on its servers. Not offered for purchase yet |
| Auth | Email and password. First account is admin | Same accounts. Signup mode is an admin setting |
| Tenant | Fixed id `self` | Fixed placeholder id `placeholder` — not a customer, not isolation |
| Billing | Not applicable | Hooks exist and are stubs. They do not check a subscription, record usage, or block work |
| Model keys | Yours, server-side | Same rule when a hosted process exists: keys stay on the server |
| Product features | Chat, tools, MCP (see below) | **The same features.** Nothing is SaaS-only |

Unset `BOTANICAL_DEPLOYMENT_MODE` means `self-host`. A process does not become SaaS by accident.

## What exists today

**Product (both modes):** an always-on server plus a web client:

- Streaming chat, tools, and MCP
- Unlimited user-defined agents, group chats with several agents, async agent-to-agent messaging
- Built-ins: web search/fetch, shell/code exec, file read/write
- Postgres; model API keys server-side only; no silent default model
- TypeScript on Bun

**Commercial shape (this codebase, not a store):**

- `DeploymentMode`: `self-host` \| `saas`, loaded from the environment in `@botanical/core`
- Feature flags: `singleTenantPasscode` (self-host only), `placeholderTenantId` (SaaS only), `billingEnabled` (always `false`)
- Self-host passcode: `BOTANICAL_PASSWORD` or `BOTANICAL_PASSWORD_HASH` (`sha256:<64 hex chars>`)
- SaaS tenant id: the constant `placeholder`
- Billing hooks `assertCanSpend`, `recordUsage`, `resolveSubscription` — safe to call, not wired to a payment provider

The mode flag exists so the code does not assume a single hosting model.

## What does not exist yet

- A payment provider, checkout, plans, invoices, seats, or quotas
- Real `tenant_id` issuance. Accounts isolate rows by user on one database; they are not separate tenants
- A hosted plan you can buy
- Metering a self-hosted install
- Different chat, tools, or MCP behavior per mode

Teams, real multi-tenant accounts, and subscription enforcement are on the [roadmap](./ROADMAP.md). The placeholder and the hooks are the seam, not the product.

## Config

| Variable | Self-host | SaaS |
|----------|-----------|------|
| `BOTANICAL_DEPLOYMENT_MODE` | `self-host` (default). Aliases: `self_host`, `SELF_HOST`, `oss`, `open-source` | `saas`. Alias: `hosted` |
| `BOTANICAL_PASSWORD` | Exactly one of password or hash | Unset. If set, boot fails |
| `BOTANICAL_PASSWORD_HASH` | `sha256:` + SHA-256 of the passcode, no newline | Unset. If set, boot fails |
| `BOTANICAL_TENANT_ID` | Unset. Loader assigns `self` | Unset. Loader assigns `placeholder` |

Example file: [packages/core/.env.example](../packages/core/.env.example). Errors from the loader do not echo secret values.

Hash a passcode:

```sh
printf '%s' 'your-passcode' | sha256sum | awk '{print "sha256:"$1}'
```

## How callers should use it

```ts
import { loadDeploymentConfig, summarizeDeployment, verifySingleTenantPasscode } from "@botanical/core";

const deployment = loadDeploymentConfig();
// Log the summary. The config object holds the passcode.
console.log(summarizeDeployment(deployment));

function checkPasscode(presentedPasscode: string) {
  if (!deployment.features.singleTenantPasscode) {
    return { ok: false, reason: "not-single-tenant" };
  }
  return verifySingleTenantPasscode(deployment, presentedPasscode);
}

// v0: self-host → allowed, reason "not-applicable"
//     saas      → allowed, reason "billing-not-implemented"
await deployment.billing.assertCanSpend({
  tenantId: deployment.tenantId,
  meter: "chat.completion",
});
```

Invariants:

- Do not hard-code SaaS-only assumptions (required subscription, required customer tenant, SaaS-only tools).
- Do not flip `billingEnabled` for self-host. The flag is frozen `false` in both modes until billing ships.
- Do not treat `placeholder` as a real tenant. `resolveSubscription` returns the process tenant id, not whatever id the caller passed.
- `readDeploymentMode()` only parses the mode (health checks). `loadDeploymentConfig()` is the strict boot path.

## Related

- [DECISIONS.md](./DECISIONS.md): design decisions
- [ROADMAP.md](./ROADMAP.md): planned work
- [ARCHITECTURE.md](./ARCHITECTURE.md) — server, web, Postgres
- [LICENSE](../LICENSE) — MIT
