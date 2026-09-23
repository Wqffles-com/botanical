# Botanical — Business model

Same MIT codebase. Two deployment modes. v0 encodes the split and does **not** charge anyone.

Locked product scope stays in [DECISIONS.md](./DECISIONS.md). This page is how self-host and hosted relate, and what “v0” means for money and tenancy.

## The split

| | Self-host (open source) | Hosted (SaaS) |
|--|-------------------------|---------------|
| Code license | **MIT** — use, modify, redistribute | **Same MIT code**. A subscription would pay for *our* operation of that code, not for a separate license |
| Mode | `self-host` (default) | `saas` |
| Who runs it | You, on any host | Botanical, on our servers — not offered for purchase in v0 |
| Auth | One passcode for the single operator | Account login is **not** built. The single-tenant passcode is rejected in this mode |
| Tenant | Fixed id `self` | Fixed placeholder id `placeholder` — not a customer, not isolation |
| Billing | Not applicable | Hooks exist and are stubs. They do not check a subscription, record usage, or block work |
| Model keys | Yours, server-side | Same rule when a hosted process exists: keys stay on the server |
| Product features | Chat, tools, MCP (see below) | **The same features.** Nothing is SaaS-only |

Unset `BOTANICAL_DEPLOYMENT_MODE` means `self-host`. A process does not become SaaS by accident.

## What v0 includes

**Product (both modes)** — personal hosted server + web client:

- Streaming chat, tools, and MCP
- Unlimited user-defined agents, one agent per chat, async agent-to-agent messaging
- Built-ins: web search/fetch, shell/code exec, file read/write
- Postgres; model API keys server-side only; no silent default model
- TypeScript on Bun or Deno (chosen at scaffold)

**Commercial shape (this codebase, not a store):**

- `DeploymentMode`: `self-host` \| `saas`, loaded from the environment in `@botanical/core`
- Feature flags: `singleTenantPasscode` (self-host only), `placeholderTenantId` (SaaS only), `billingEnabled` (always `false`)
- Self-host passcode: `BOTANICAL_PASSWORD` or `BOTANICAL_PASSWORD_HASH` (`sha256:<64 hex chars>`)
- SaaS tenant id: the constant `placeholder`
- Billing hooks `assertCanSpend`, `recordUsage`, `resolveSubscription` — safe to call, not wired to a payment provider

Audience for the product is still Charlie as a personal power user. The mode flag is so the code does not assume one host model. It is not a public SaaS launch and not an OSS-community growth program.

## What v0 does not include

- A payment provider, checkout, plans, invoices, seats, or quotas
- Signup, real `tenant_id` issuance, or per-tenant data isolation
- A hosted plan you can buy
- Metering a self-hosted install
- Different chat, tools, or MCP behavior per mode

Teams, real multi-tenant accounts, and subscription enforcement stay **post-v0**. The placeholder and the hooks are the seam, not the product.

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

- [DECISIONS.md](./DECISIONS.md) — locked product scope
- [ARCHITECTURE.md](./ARCHITECTURE.md) — server, web, Postgres
- [LICENSE](../LICENSE) — MIT
