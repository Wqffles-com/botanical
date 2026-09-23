import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { cookieSecure, evaluateConfig, providerFlags } from "../src/config.js";

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DEPLOYMENT_MODE: "self_host",
    BOTANICAL_PASSCODE: "local-dev-passcode",
    DATABASE_URL: "postgresql://botanical:botanical@postgres:5432/botanical",
    POSTGRES_PASSWORD: "botanical",
    ...extra,
  };
}

describe("evaluateConfig", () => {
  test("accepts a self-host config", () => {
    const result = evaluateConfig(baseEnv());
    expect(result.errors).toEqual([]);
    expect(result.config?.mode).toBe("self_host");
    expect(result.config?.sessionDerived).toBe(true);
  });

  test("rejects an unknown deployment mode", () => {
    const result = evaluateConfig(baseEnv({ DEPLOYMENT_MODE: "cloud" }));
    expect(result.config).toBeNull();
    expect(result.errors.some((error) => error.includes("DEPLOYMENT_MODE"))).toBe(true);
  });

  test("requires deployment mode", () => {
    const env = baseEnv();
    delete env.DEPLOYMENT_MODE;
    const result = evaluateConfig(env);
    expect(result.errors.some((error) => error.includes("DEPLOYMENT_MODE"))).toBe(true);
  });

  test("saas rejects placeholder secrets", () => {
    const result = evaluateConfig(
      baseEnv({
        DEPLOYMENT_MODE: "saas",
        BOTANICAL_PASSCODE: "change-me-to-a-long-random-passcode",
        BOTANICAL_SESSION_SECRET: "change-me-session-secret",
      }),
    );
    expect(result.config).toBeNull();
    expect(result.errors.some((error) => error.includes("example BOTANICAL_PASSCODE"))).toBe(true);
    expect(result.errors.some((error) => error.includes("example BOTANICAL_SESSION_SECRET"))).toBe(true);
  });

  test("warns when the self-host session secret is the example", () => {
    const result = evaluateConfig(baseEnv({ BOTANICAL_SESSION_SECRET: "change-me-session-secret" }));
    expect(result.errors).toEqual([]);
    expect(result.config?.sessionDerived).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("BOTANICAL_SESSION_SECRET"))).toBe(true);
  });

  test("saas accepts long secrets and warns on cleartext origin", () => {
    const result = evaluateConfig(
      baseEnv({
        DEPLOYMENT_MODE: "saas",
        BOTANICAL_PASSCODE: "correct-horse-battery",
        BOTANICAL_SESSION_SECRET: "a-long-session-secret-value",
        BOTANICAL_PUBLIC_ORIGIN: "http://botanical.example.com",
        POSTGRES_PASSWORD: "not-the-url-password",
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.config?.sessionDerived).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("https"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("POSTGRES_PASSWORD"))).toBe(true);
  });

  test("warns when the database host is localhost", () => {
    const result = evaluateConfig(
      baseEnv({
        DATABASE_URL: "postgresql://botanical:botanical@127.0.0.1:5432/botanical",
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("localhost"))).toBe(true);
  });

  test("reads a passcode from a file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "botanical-"));
    const file = path.join(dir, "passcode");
    writeFileSync(file, "file-passcode-value\n");
    const env = baseEnv();
    delete env.BOTANICAL_PASSCODE;
    env.BOTANICAL_PASSCODE_FILE = file;
    const result = evaluateConfig(env);
    expect(result.errors).toEqual([]);
    expect(result.config?.passcode).toBe("file-passcode-value");
  });

  test("parses sslmode=require", () => {
    const result = evaluateConfig(
      baseEnv({
        DATABASE_URL: "postgresql://botanical:botanical@db.example:5432/botanical?sslmode=require",
        USE_BUNDLED_DATABASE: "0",
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.config?.databaseSsl).toBe("require");
  });
});

describe("helpers", () => {
  test("cookie secure follows the public origin in auto mode", () => {
    expect(cookieSecure({ BOTANICAL_PUBLIC_ORIGIN: "https://botanical.example" })).toBe(true);
    expect(cookieSecure({ BOTANICAL_PUBLIC_ORIGIN: "http://localhost:8080" })).toBe(false);
    expect(cookieSecure({ COOKIE_SECURE: "1", BOTANICAL_PUBLIC_ORIGIN: "http://localhost" })).toBe(true);
  });

  test("provider flags never echo key material", () => {
    const flags = providerFlags({ OPENAI_API_KEY: "sk-secret", XAI_API_KEY: "  " });
    expect(flags.openai).toBe(true);
    expect(flags.xai).toBe(false);
    expect(JSON.stringify(flags)).not.toContain("sk-secret");
  });
});
