import type {
  BillingDecision,
  BillingHooks,
  BillingRecordResult,
  BillingSpendInput,
  BillingUsageInput,
  DeploymentMode,
  SubscriptionSnapshot,
} from "./types.ts";

/**
 * Stub billing hooks.
 *
 * Self-host returns `not-applicable` and allows the call: Botanical does not
 * meter MIT installs. SaaS returns `billing-not-implemented` and also allows
 * the call: no payment provider is wired in v0. Neither path stores usage.
 */
export function createBillingHooks(mode: DeploymentMode, tenantId: string): BillingHooks {
  const reason = mode === "self-host" ? "not-applicable" : "billing-not-implemented";
  const status = mode === "self-host" ? "none" : "unknown";

  return Object.freeze({
    enabled: false as const,
    async assertCanSpend(_input: BillingSpendInput): Promise<BillingDecision> {
      return { allowed: true, reason, mode };
    },
    async recordUsage(_input: BillingUsageInput): Promise<BillingRecordResult> {
      return { recorded: false, reason, mode };
    },
    async resolveSubscription(_requestedTenantId: string): Promise<SubscriptionSnapshot> {
      return { status, reason, mode, tenantId };
    },
  });
}
