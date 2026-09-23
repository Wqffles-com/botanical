/**
 * Shared Botanical types.
 * v0: deployment mode (`self-host` | `saas`). Import this instead of hard-coding a host model.
 */
export {
  BILLING_HOOK_NAMES,
  DEPLOYMENT_ENV,
  DEPLOYMENT_MODES,
  DeploymentConfigError,
  DeploymentConfigErrorCode,
  SAAS_PLACEHOLDER_TENANT_ID,
  SELF_HOST_TENANT_ID,
  createBillingHooks,
  deriveFeatureFlags,
  hashPasscode,
  loadDeploymentConfig,
  readDeploymentMode,
  summarizeDeployment,
  verifySingleTenantPasscode,
} from "./deployment/index.ts";
export type {
  BillingDecision,
  BillingHookName,
  BillingHooks,
  BillingReason,
  BillingRecordResult,
  BillingSpendInput,
  BillingUsageInput,
  DeploymentConfig,
  DeploymentEnv,
  DeploymentMode,
  DeploymentSummary,
  FeatureFlags,
  PasscodeCheck,
  PasscodeSource,
  SingleTenantPasscode,
  SubscriptionSnapshot,
} from "./deployment/index.ts";
