import { describe, expect, test } from "bun:test";

import {
  BILLING_HOOK_NAMES,
  DeploymentConfigError,
  DeploymentConfigErrorCode,
  SAAS_PLACEHOLDER_TENANT_ID,
  SELF_HOST_TENANT_ID,
  deriveFeatureFlags,
  hashPasscode,
  loadDeploymentConfig,
  readDeploymentMode,
  summarizeDeployment,
  verifySingleTenantPasscode,
  type DeploymentConfigErrorCode as DeploymentConfigErrorCodeName,
  type DeploymentEnv,
} from "./index.ts";

const SECRET = "super-secret-pass";
const KNOWN_SHA256 =
  "sha256:2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";

function expectConfigError(env: DeploymentEnv, code: DeploymentConfigErrorCodeName): DeploymentConfigError {
  try {
    loadDeploymentConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(DeploymentConfigError);
    const configError = error as DeploymentConfigError;
    expect(configError.code).toBe(code);
    expect(configError.message).not.toContain(SECRET);
    expect(configError.message).not.toContain("SHOULD-NOT-LEAK");
    return configError;
  }
  throw new Error(`expected DeploymentConfigError ${code}`);
}

describe("readDeploymentMode", () => {
  test("defaults to self-host without reading a passcode", () => {
    expect(readDeploymentMode({})).toBe("self-host");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "   " })).toBe("self-host");
  });

  test("accepts canonical values and aliases", () => {
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "self-host" })).toBe("self-host");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "SELF_HOST" })).toBe("self-host");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "oss" })).toBe("self-host");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "open-source" })).toBe("self-host");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "  SaaS  " })).toBe("saas");
    expect(readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "hosted" })).toBe("saas");
  });

  test("rejects unknown modes and does not echo a long value", () => {
    expect(() => readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "enterprise" })).toThrow(DeploymentConfigError);
    try {
      readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "enterprise" });
    } catch (caught) {
      expect((caught as DeploymentConfigError).code).toBe(DeploymentConfigErrorCode.InvalidMode);
      expect((caught as Error).message).toContain("enterprise");
    }

    try {
      readDeploymentMode({ BOTANICAL_DEPLOYMENT_MODE: "x".repeat(80) });
    } catch (caught) {
      expect((caught as Error).message).toContain("unrecognized value");
      expect((caught as Error).message).not.toContain("x".repeat(40));
    }
  });
});

describe("self-host", () => {
  test("requires a single-tenant passcode and pins tenant id self", () => {
    expectConfigError({}, DeploymentConfigErrorCode.MissingPasscode);

    const config = loadDeploymentConfig({ BOTANICAL_PASSWORD: SECRET });
    expect(config.mode).toBe("self-host");
    expect(config.tenantId).toBe(SELF_HOST_TENANT_ID);
    expect(config.tenantIdIsPlaceholder).toBe(false);
    expect(config.features).toEqual({
      singleTenantPasscode: true,
      placeholderTenantId: false,
      billingEnabled: false,
    });
    expect(config.passcode).toEqual({ source: "password", secret: SECRET });
    expect(verifySingleTenantPasscode(config, SECRET)).toEqual({ ok: true });
    expect(verifySingleTenantPasscode(config, "nope")).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySingleTenantPasscode(config, "")).toEqual({ ok: false, reason: "mismatch" });
  });

  test("accepts a sha256 passcode hash and does not keep the plaintext", () => {
    expect(hashPasscode("secret")).toBe(KNOWN_SHA256);
    const config = loadDeploymentConfig({
      BOTANICAL_DEPLOYMENT_MODE: "self_host",
      BOTANICAL_PASSWORD_HASH: `SHA256:${KNOWN_SHA256.slice("sha256:".length).toUpperCase()}`,
    });
    expect(config.passcode).toEqual({ source: "hash", secret: KNOWN_SHA256 });
    expect(config.passcode?.secret).not.toBe("secret");
    expect(verifySingleTenantPasscode(config, "secret")).toEqual({ ok: true });
    expect(verifySingleTenantPasscode(config, SECRET)).toEqual({ ok: false, reason: "mismatch" });
  });

  test("rejects ambiguous passcode material, a bad hash, and an explicit tenant id", () => {
    expectConfigError(
      { BOTANICAL_PASSWORD: SECRET, BOTANICAL_PASSWORD_HASH: KNOWN_SHA256 },
      DeploymentConfigErrorCode.AmbiguousPasscode,
    );
    expectConfigError(
      { BOTANICAL_PASSWORD_HASH: "sha256:SHOULD-NOT-LEAK" },
      DeploymentConfigErrorCode.InvalidPasscodeHash,
    );
    expectConfigError(
      { BOTANICAL_PASSWORD: SECRET, BOTANICAL_TENANT_ID: "customer-1" },
      DeploymentConfigErrorCode.TenantIdNotInV0,
    );
  });

  test("summary redacts the passcode", () => {
    const config = loadDeploymentConfig({ BOTANICAL_PASSWORD: SECRET });
    const summary = summarizeDeployment(config);
    expect(summary.passcode).toEqual({ configured: true, source: "password" });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(summary.billingEnabled).toBe(false);
  });
});

describe("saas", () => {
  test("uses the placeholder tenant and stub billing without a passcode", async () => {
    const config = loadDeploymentConfig({ BOTANICAL_DEPLOYMENT_MODE: "saas" });
    expect(config.mode).toBe("saas");
    expect(config.tenantId).toBe(SAAS_PLACEHOLDER_TENANT_ID);
    expect(config.tenantIdIsPlaceholder).toBe(true);
    expect(config.passcode).toBeNull();
    expect(config.features).toEqual(deriveFeatureFlags("saas"));
    expect(config.features.placeholderTenantId).toBe(true);
    expect(config.features.singleTenantPasscode).toBe(false);
    expect(config.features.billingEnabled).toBe(false);
    expect(config.billing.enabled).toBe(false);
    expect(verifySingleTenantPasscode(config, SECRET)).toEqual({
      ok: false,
      reason: "not-single-tenant",
    });

    const decision = await config.billing.assertCanSpend({
      tenantId: "someone-else",
      meter: "chat.completion",
      units: 3,
    });
    expect(decision).toEqual({
      allowed: true,
      reason: "billing-not-implemented",
      mode: "saas",
    });

    const recorded = await config.billing.recordUsage({
      tenantId: config.tenantId,
      meter: "chat.completion",
      units: 3,
      idempotencyKey: "once",
    });
    expect(recorded).toEqual({
      recorded: false,
      reason: "billing-not-implemented",
      mode: "saas",
    });

    const subscription = await config.billing.resolveSubscription("customer-1");
    expect(subscription).toEqual({
      status: "unknown",
      reason: "billing-not-implemented",
      mode: "saas",
      tenantId: SAAS_PLACEHOLDER_TENANT_ID,
    });

    expect(summarizeDeployment(config).passcode).toEqual({ configured: false });
  });

  test("rejects passcode env and an operator-supplied tenant id", () => {
    expectConfigError(
      { BOTANICAL_DEPLOYMENT_MODE: "SAAS", BOTANICAL_PASSWORD: SECRET },
      DeploymentConfigErrorCode.PasscodeNotInSaas,
    );
    expectConfigError(
      { BOTANICAL_DEPLOYMENT_MODE: "hosted", BOTANICAL_PASSWORD_HASH: KNOWN_SHA256 },
      DeploymentConfigErrorCode.PasscodeNotInSaas,
    );
    expectConfigError(
      { BOTANICAL_DEPLOYMENT_MODE: "saas", BOTANICAL_TENANT_ID: SAAS_PLACEHOLDER_TENANT_ID },
      DeploymentConfigErrorCode.TenantIdNotInV0,
    );
  });
});

describe("billing hooks", () => {
  test("self-host is not billed and nothing is recorded", async () => {
    const config = loadDeploymentConfig({ BOTANICAL_PASSWORD: SECRET });
    expect(BILLING_HOOK_NAMES).toEqual(["assertCanSpend", "recordUsage", "resolveSubscription"]);
    expect(await config.billing.assertCanSpend({ tenantId: config.tenantId, meter: "shell" })).toEqual({
      allowed: true,
      reason: "not-applicable",
      mode: "self-host",
    });
    expect(
      await config.billing.recordUsage({ tenantId: config.tenantId, meter: "shell", units: -1 }),
    ).toEqual({ recorded: false, reason: "not-applicable", mode: "self-host" });
    expect(await config.billing.resolveSubscription("other")).toEqual({
      status: "none",
      reason: "not-applicable",
      mode: "self-host",
      tenantId: SELF_HOST_TENANT_ID,
    });
  });

  test("flags stay frozen off", () => {
    const flags = deriveFeatureFlags("saas");
    expect(() => {
      (flags as { billingEnabled: boolean }).billingEnabled = true;
    }).toThrow();
  });
});
