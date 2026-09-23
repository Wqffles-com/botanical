# @botanical/core

Shared types for Botanical. This slice is the deployment-mode config: `self-host` or `saas`.

Server and other packages should import `@botanical/core` instead of hard-coding a host model. Billing is stubbed. See [docs/BUSINESS_MODEL.md](../../docs/BUSINESS_MODEL.md).

```ts
import { loadDeploymentConfig, verifySingleTenantPasscode } from "@botanical/core";

const deployment = loadDeploymentConfig();

function checkPasscode(presentedPasscode: string) {
  if (!deployment.features.singleTenantPasscode) return;
  return verifySingleTenantPasscode(deployment, presentedPasscode);
}

const decision = await deployment.billing.assertCanSpend({
  tenantId: deployment.tenantId,
  meter: "chat.completion",
});
```

`bun test` and `bun run typecheck` from this package.
