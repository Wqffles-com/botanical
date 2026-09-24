import { describe, expect, test } from "bun:test";
import { clearSession, loadSession, saveSession, type KeyValueStore } from "./session";

function memory(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("session persistence", () => {
  test("round-trips a bearer token and drops an expired one", () => {
    const store = memory();
    saveSession({ token: "secret-token", expiresAt: "2099-01-01T00:00:00.000Z" }, store);
    expect(loadSession(store, Date.parse("2026-09-23T00:00:00.000Z"))).toEqual({
      token: "secret-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    saveSession({ token: "secret-token", expiresAt: "2020-01-01T00:00:00.000Z" }, store);
    expect(loadSession(store, Date.parse("2026-09-23T00:00:00.000Z"))).toBeNull();
    expect(store.getItem("botanical.session.v1")).toBeNull();
  });

  test("ignores a blank token and malformed json", () => {
    const store = memory();
    saveSession({ token: "   ", expiresAt: null }, store);
    expect(store.getItem("botanical.session.v1")).toBeNull();
    store.setItem("botanical.session.v1", "{");
    expect(loadSession(store)).toBeNull();
    clearSession(store);
    expect(loadSession(store)).toBeNull();
  });
});
