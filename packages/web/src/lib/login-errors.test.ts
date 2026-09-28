import { describe, expect, test } from "bun:test";
import { BotanicalApiError } from "@botanical/core";
import { loginErrorText, passwordClientError } from "./login-errors";

describe("loginErrorText", () => {
  test("maps auth failures", () => {
    expect(loginErrorText(new BotanicalApiError("no", { status: 401 }))).toBe(
      "That email or password was not accepted.",
    );
    expect(loginErrorText(new BotanicalApiError("closed", { status: 403 }))).toBe("closed");
    expect(loginErrorText(new BotanicalApiError("busy", { status: 429 }))).toBe(
      "Too many login attempts. Try again later.",
    );
    expect(loginErrorText(new BotanicalApiError("down", { status: 500 }))).toBe(
      "The server could not sign you in. Try again.",
    );
  });
});

describe("passwordClientError", () => {
  test("rejects empty and short signup passwords", () => {
    expect(passwordClientError("", true)).toBe("Enter your password.");
    expect(passwordClientError("short", true)).toBe("Password must be at least 8 characters.");
    expect(passwordClientError("long-enough", true)).toBeNull();
    expect(passwordClientError("x", false)).toBeNull();
  });
});
