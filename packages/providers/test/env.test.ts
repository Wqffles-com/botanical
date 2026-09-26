import { describe, expect, test } from "bun:test";
import { MissingApiKeyError, ProviderError } from "../src/errors.ts";
import { isApiKeyConfigured, resolveApiKey } from "../src/env.ts";

describe("server env keys", () => {
  test("trims and refuses empty values", () => {
    expect(resolveApiKey("OPENAI_API_KEY", { OPENAI_API_KEY: "  sk-test  " }, "openai")).toBe("sk-test");
    expect(isApiKeyConfigured("OPENAI_API_KEY", { OPENAI_API_KEY: "   " })).toBe(false);
    expect(() => resolveApiKey("OPENAI_API_KEY", {}, "openai")).toThrow(MissingApiKeyError);
  });

  test("rejects a raw key used as the variable name", () => {
    expect(() => resolveApiKey("sk-live-secret", { "sk-live-secret": "nope" })).toThrow(ProviderError);
  });
});
