/** How this Botanical process is deployed. Same codebase either way. */
export const DEPLOYMENT_MODES = ["self-host", "saas"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/**
 * Tenant id stamped by a self-hosted process.
 * One operator, not a customer record.
 */
export const SELF_HOST_TENANT_ID = "self";

/**
 * Tenant id used by SaaS until real tenancy exists.
 * Not a customer id and not an isolation boundary.
 */
export const SAAS_PLACEHOLDER_TENANT_ID = "placeholder";

export const DEPLOYMENT_ENV = {
  mode: "BOTANICAL_DEPLOYMENT_MODE",
  password: "BOTANICAL_PASSWORD",
  passwordHash: "BOTANICAL_PASSWORD_HASH",
  tenantId: "BOTANICAL_TENANT_ID",
} as const;

export type PasscodeSource = "password" | "hash";

/** Single-operator secret for self-host. Never log `secret`. */
export interface SingleTenantPasscode {
  readonly source: PasscodeSource;
  readonly secret: string;
}

/**
 * Mode switches that exist in v0.
 * Product features (chat, tools, MCP) are not gated by these.
 */
export interface FeatureFlags {
  /**
   * Self-host web→server auth is one shared passcode.
   * False in SaaS: account login is not implemented.
   */
  readonly singleTenantPasscode: boolean;
  /** True when `tenantId` is {@link SAAS_PLACEHOLDER_TENANT_ID}. */
  readonly placeholderTenantId: boolean;
  /**
   * Subscription enforcement. Hard-coded off until billing ships.
   * Self-host stays off: MIT self-host is not a Botanical subscription.
   */
  readonly billingEnabled: false;
}

/** Reasons a billing hook can return. v0 stubs use only the first two. */
export type BillingReason =
  | "not-applicable"
  | "billing-not-implemented"
  | "subscription-required"
  | "quota-exceeded";

export interface BillingSpendInput {
  readonly tenantId: string;
  readonly meter: string;
  readonly units?: number;
}

export interface BillingUsageInput {
  readonly tenantId: string;
  readonly meter: string;
  readonly units: number;
  readonly idempotencyKey?: string;
}

export interface BillingDecision {
  readonly allowed: boolean;
  readonly reason: BillingReason;
  readonly mode: DeploymentMode;
}

export interface BillingRecordResult {
  readonly recorded: false;
  readonly reason: BillingReason;
  readonly mode: DeploymentMode;
}

export interface SubscriptionSnapshot {
  /** v0 never returns an active or inactive subscription. */
  readonly status: "none" | "unknown";
  readonly reason: BillingReason;
  readonly mode: DeploymentMode;
  readonly tenantId: string;
}

/**
 * Billing seam. v0 implementations do not call a payment provider,
 * do not persist usage, and do not block work.
 */
export interface BillingHooks {
  readonly enabled: false;
  readonly assertCanSpend: (input: BillingSpendInput) => Promise<BillingDecision>;
  readonly recordUsage: (input: BillingUsageInput) => Promise<BillingRecordResult>;
  readonly resolveSubscription: (tenantId: string) => Promise<SubscriptionSnapshot>;
}

export const BILLING_HOOK_NAMES = [
  "assertCanSpend",
  "recordUsage",
  "resolveSubscription",
] as const;

export type BillingHookName = (typeof BILLING_HOOK_NAMES)[number];

export interface DeploymentConfig {
  readonly mode: DeploymentMode;
  readonly tenantId: string;
  readonly tenantIdIsPlaceholder: boolean;
  /** Set only when {@link FeatureFlags.singleTenantPasscode} is true. */
  readonly passcode: SingleTenantPasscode | null;
  readonly features: FeatureFlags;
  readonly billing: BillingHooks;
}

/** Safe to log. Contains no passcode material. */
export interface DeploymentSummary {
  readonly mode: DeploymentMode;
  readonly tenantId: string;
  readonly tenantIdIsPlaceholder: boolean;
  readonly features: FeatureFlags;
  readonly passcode:
    | { readonly configured: true; readonly source: PasscodeSource }
    | { readonly configured: false };
  readonly billingEnabled: false;
}

export type PasscodeCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "mismatch" | "not-single-tenant" | "missing-passcode";
    };

export const DeploymentConfigErrorCode = {
  InvalidMode: "invalid-mode",
  MissingPasscode: "missing-passcode",
  AmbiguousPasscode: "ambiguous-passcode",
  InvalidPasscodeHash: "invalid-passcode-hash",
  TenantIdNotInV0: "tenant-id-not-in-v0",
  PasscodeNotInSaas: "passcode-not-in-saas",
} as const;

export type DeploymentConfigErrorCode =
  (typeof DeploymentConfigErrorCode)[keyof typeof DeploymentConfigErrorCode];

export class DeploymentConfigError extends Error {
  override readonly name = "DeploymentConfigError";

  constructor(
    readonly code: DeploymentConfigErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Variables the loader reads. Extra keys are ignored. */
export interface DeploymentEnv {
  readonly BOTANICAL_DEPLOYMENT_MODE?: string;
  readonly BOTANICAL_PASSWORD?: string;
  readonly BOTANICAL_PASSWORD_HASH?: string;
  readonly BOTANICAL_TENANT_ID?: string;
}
