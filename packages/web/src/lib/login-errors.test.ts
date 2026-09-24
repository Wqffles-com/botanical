import { describe, expect, test } from "bun:test";
import { BotanicalApiError } from "@botanical/core";
import { loginErrorText, passcodeClientError } from "./login-errors";

describe("loginErrorText", () => {
  test("maps unauthorized and rate-limited responses", () => {
    expect(loginErrorText(new BotanicalApiError("nope", { status: 401 }))).toBe(
      "That passcode was not accepted.",
    );
    expect(loginErrorText(new BotanicalApiError("slow down", { status: 429 }))).toBe(
      "Too many login attempts. Try again later.",
    );
    expect(loginErrorText(new BotanicalApiError("bad", { status: 400 }))).toBe("bad");
    expect(loginErrorText(new BotanicalApiError("boom", { status: 500 }))).toBe(
      "The server could not check the passcode. Try again.",
    );
  });

  test("maps network failures", () => {
    const error = new TypeError("Failed to fetch");
    expect(loginErrorText(error)).toBe("Botanical server is unreachable.");
  });
});

describe("passcodeClientError", () => {
  test("rejects empty and short passcodes", () => {
    expect(passcodeClientError("")).toBe("Enter the server passcode.");
    expect(passcodeClientError("  ab ")).toBe("Passcode is too short.");
    expect(passcodeClientError("sprout")).toBeNull();
  });
});
