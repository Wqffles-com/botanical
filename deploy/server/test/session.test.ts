import { describe, expect, test } from "bun:test";
import { safeEqual, sessionCookie, signSession, verifySession } from "../src/session.js";

describe("session", () => {
  test("signs and verifies a token", () => {
    const token = signSession("secret", 60, "self_host", 1_000);
    const body = verifySession("secret", token, 1_010);
    expect(body).toEqual({ exp: 1_060, mode: "self_host", v: 1 });
  });

  test("rejects a tampered token and the wrong secret", () => {
    const token = signSession("secret", 60, "saas", 1_000);
    expect(verifySession("other", token, 1_010)).toBeNull();
    const [payload, sig] = token.split(".");
    expect(verifySession("secret", `${payload}.${sig?.slice(0, -1)}x`, 1_010)).toBeNull();
  });

  test("rejects an expired token", () => {
    const token = signSession("secret", 10, "self_host", 1_000);
    expect(verifySession("secret", token, 1_011)).toBeNull();
  });

  test("compares passcodes without leaking length", () => {
    expect(safeEqual("local-dev-passcode", "local-dev-passcode")).toBe(true);
    expect(safeEqual("local-dev-passcode", "nope")).toBe(false);
    expect(safeEqual("short", "a-much-longer-passcode")).toBe(false);
  });

  test("sets and clears the session cookie", () => {
    const set = sessionCookie("abc", 60, false);
    expect(set).toContain("botanical_session=abc");
    expect(set).toContain("HttpOnly");
    expect(set).not.toContain("Secure");
    const clear = sessionCookie("", 0, true, true);
    expect(clear).toContain("Max-Age=0");
    expect(clear).toContain("Secure");
  });
});
