import { createBillingHooks } from "./billing.ts";
import { normalizePasscodeHash } from "./passcode.ts";
import {
  DeploymentConfigError,
  DeploymentConfigErrorCode,
  SAAS_PLACEHOLDER_TENANT_ID,
  SELF_HOST_TENANT_ID,
  type DeploymentConfig,
  type DeploymentEnv,
  type DeploymentMode,
  type DeploymentSummary,
  type FeatureFlags,
  type SingleTenantPasscode,
} from "./types.ts";

const MODE_ALIASES: Readonly<Record<string, DeploymentMode>> = {
  "self-host": "self-host",
  selfhost: "self-host",
  oss: "self-host",
  "open-source": "self-host",
  opensource: "self-host",
  saas: "saas",
  hosted: "saas",
};

/**
 * Read the mode only. Does not require a passcode.
 * Unset or blank defaults to `self-host` so a process never becomes SaaS by accident.
 */
export function readDeploymentMode(env: DeploymentEnv = process.env): DeploymentMode {
  const raw = env.BOTANICAL_DEPLOYMENT_MODE;
  if (raw === undefined || raw.trim() === "") return "self-host";

  const key = raw.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  const mode = MODE_ALIASES[key];
  if (mode === undefined) {
    throw new DeploymentConfigError(
      DeploymentConfigErrorCode.InvalidMode,
      `BOTANICAL_DEPLOYMENT_MODE must be "self-host" or "saas" (${displayMode(raw)}). Aliases: self_host, SELF_HOST, oss, hosted.`,
    );
  }
  return mode;
}

export function deriveFeatureFlags(mode: DeploymentMode): FeatureFlags {
  return Object.freeze(
    mode === "self-host"
      ? {
          singleTenantPasscode: true,
          placeholderTenantId: false,
          billingEnabled: false as const,
        }
      : {
          singleTenantPasscode: false,
          placeholderTenantId: true,
          billingEnabled: false as const,
        },
  );
}

/**
 * Load deployment config for this process.
 *
 * Self-host requires exactly one of `BOTANICAL_PASSWORD` or `BOTANICAL_PASSWORD_HASH`.
 * SaaS rejects both: account auth is not implemented, and the passcode is not a tenant credential.
 * `BOTANICAL_TENANT_ID` is rejected in both modes; v0 assigns the tenant id itself.
 */
export function loadDeploymentConfig(env: DeploymentEnv = process.env): DeploymentConfig {
  const mode = readDeploymentMode(env);
  assertTenantNotSet(env);
  const features = deriveFeatureFlags(mode);

  if (mode === "self-host") {
    const passcode = readSelfHostPasscode(env);
    return freezeConfig({
      mode,
      tenantId: SELF_HOST_TENANT_ID,
      tenantIdIsPlaceholder: false,
      passcode,
      features,
      billing: createBillingHooks(mode, SELF_HOST_TENANT_ID),
    });
  }

  assertSaasHasNoPasscode(env);
  return freezeConfig({
    mode,
    tenantId: SAAS_PLACEHOLDER_TENANT_ID,
    tenantIdIsPlaceholder: true,
    passcode: null,
    features,
    billing: createBillingHooks(mode, SAAS_PLACEHOLDER_TENANT_ID),
  });
}

export function summarizeDeployment(config: DeploymentConfig): DeploymentSummary {
  return Object.freeze({
    mode: config.mode,
    tenantId: config.tenantId,
    tenantIdIsPlaceholder: config.tenantIdIsPlaceholder,
    features: config.features,
    passcode:
      config.passcode === null
        ? { configured: false as const }
        : { configured: true as const, source: config.passcode.source },
    billingEnabled: false as const,
  });
}

function freezeConfig(config: DeploymentConfig): DeploymentConfig {
  return Object.freeze(config);
}

function readSelfHostPasscode(env: DeploymentEnv): SingleTenantPasscode {
  const password = present(env.BOTANICAL_PASSWORD);
  const hash = present(env.BOTANICAL_PASSWORD_HASH);
  if (password !== undefined && hash !== undefined) {
    throw new DeploymentConfigError(
      DeploymentConfigErrorCode.AmbiguousPasscode,
      "Set only one of BOTANICAL_PASSWORD or BOTANICAL_PASSWORD_HASH.",
    );
  }
  if (password !== undefined) {
    return Object.freeze({ source: "password", secret: password });
  }
  if (hash !== undefined) {
    return Object.freeze({ source: "hash", secret: normalizePasscodeHash(hash) });
  }
  throw new DeploymentConfigError(
    DeploymentConfigErrorCode.MissingPasscode,
    "Self-host mode requires BOTANICAL_PASSWORD or BOTANICAL_PASSWORD_HASH.",
  );
}

function assertSaasHasNoPasscode(env: DeploymentEnv): void {
  if (present(env.BOTANICAL_PASSWORD) === undefined && present(env.BOTANICAL_PASSWORD_HASH) === undefined) {
    return;
  }
  throw new DeploymentConfigError(
    DeploymentConfigErrorCode.PasscodeNotInSaas,
    "BOTANICAL_PASSWORD and BOTANICAL_PASSWORD_HASH are the self-host single-tenant passcode. SaaS account auth is not implemented in v0. Unset them, or set BOTANICAL_DEPLOYMENT_MODE=self-host.",
  );
}

function assertTenantNotSet(env: DeploymentEnv): void {
  const value = env.BOTANICAL_TENANT_ID;
  if (value === undefined || value.trim() === "") return;
  throw new DeploymentConfigError(
    DeploymentConfigErrorCode.TenantIdNotInV0,
    `BOTANICAL_TENANT_ID is not used in v0. Self-host tenant id is "${SELF_HOST_TENANT_ID}". SaaS tenant id is "${SAAS_PLACEHOLDER_TENANT_ID}" until real tenancy ships. Unset BOTANICAL_TENANT_ID.`,
  );
}

function present(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

/** Avoid echoing a long or multiline value (it may be a secret pasted into the wrong var). */
function displayMode(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 32 || /[\r\n]/.test(trimmed)) return "unrecognized value";
  return JSON.stringify(trimmed);
}
