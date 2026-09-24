import { describe, expect, test } from "bun:test";
import { FIXED_PATH, scrubEnv } from "../src/sandbox/env.ts";
import { ToolInputError } from "../src/errors.ts";

describe("environment scrub", () => {
  test("starts from a fixed set and does not copy the parent environment", () => {
    const previous = {
      DATABASE_URL: process.env.DATABASE_URL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      BOTANICAL_PASSWORD: process.env.BOTANICAL_PASSWORD,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      LD_PRELOAD: process.env.LD_PRELOAD,
    };
    process.env.DATABASE_URL = "postgres://user:secret@db/app";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.BOTANICAL_PASSWORD = "hunter2";
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
    process.env.LD_PRELOAD = "/tmp/evil.so";
    try {
      const env = scrubEnv();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.BOTANICAL_PASSWORD).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.LD_PRELOAD).toBeUndefined();
      expect(env.HOME).toBe("/workspace");
      expect(env.PATH).toBe(FIXED_PATH);
      expect(env.BOTANICAL_WORKSPACE).toBe("/workspace");
      expect(Object.values(env).join("\n")).not.toContain("secret");
      expect(Object.values(env).join("\n")).not.toContain("sk-test");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("operator extra env is injected only when the key is safe", () => {
    const env = scrubEnv({ MY_TOOL_FLAG: "on" });
    expect(env.MY_TOOL_FLAG).toBe("on");
    expect(env.PATH).toBe(FIXED_PATH);
    expect(() => scrubEnv({ NODE_OPTIONS: "--require /tmp/pwn.js" })).toThrow(ToolInputError);
    expect(() => scrubEnv({ BASH_FUNC_x: "() { :; }" })).toThrow(ToolInputError);
  });
});
