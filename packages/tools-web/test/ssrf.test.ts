import { describe, expect, test } from "bun:test";

import { assertSafeHttpUrl, isBlockedHostname, isNonPublicAddress, type SafeUrlOptions } from "../src/net/ssrf.ts";
import type { DnsLookup } from "../src/types.ts";

const blocked = [
  "127.0.0.1",
  "10.1.2.3",
  "192.168.1.1",
  "172.16.0.1",
  "172.31.255.255",
  "169.254.169.254",
  "0.0.0.0",
  "100.64.1.1",
  "192.0.2.1",
  "198.51.100.10",
  "203.0.113.5",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "fd00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "[::1]",
];

const allowed = [
  "8.8.8.8",
  "1.1.1.1",
  "172.15.255.255",
  "172.32.0.1",
  "100.128.0.1",
  "223.255.255.255",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
];

const dnsNotCalled: DnsLookup = async () => {
  throw new Error("dns should not be called");
};

function options(dnsLookup: DnsLookup, allowPrivate = false): SafeUrlOptions {
  return { allowPrivate, dnsLookup };
}

describe("public address check", () => {
  test("blocks non-public addresses and allows public ones", () => {
    for (const address of blocked) expect(isNonPublicAddress(address)).toBe(true);
    for (const address of allowed) expect(isNonPublicAddress(address)).toBe(false);
  });

  test("blocks local and metadata hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.localhost")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

describe("assertSafeHttpUrl", () => {
  test("rejects non-http protocols and credentials without leaking the secret", async () => {
    await expect(assertSafeHttpUrl("file:///etc/passwd", options(dnsNotCalled))).rejects.toMatchObject({
      errorCode: "invalid_url",
    });
    const error = await assertSafeHttpUrl("https://user:s3cret@example.com/", options(dnsNotCalled)).catch((caught) => caught);
    expect(error).toMatchObject({ errorCode: "invalid_url" });
    expect(String(error.message)).not.toContain("s3cret");
    const broken = await assertSafeHttpUrl("http://user:s3cret@", options(dnsNotCalled)).catch((caught) => caught);
    expect(String(broken.message)).not.toContain("s3cret");
  });

  test("blocks normalized loopback literals without DNS", async () => {
    for (const raw of ["http://127.0.0.1/", "http://2130706433/", "http://0177.0.0.1/", "http://0/", "http://[::1]/"]) {
      await expect(assertSafeHttpUrl(raw, options(dnsNotCalled))).rejects.toMatchObject({ errorCode: "blocked_url" });
    }
    await expect(assertSafeHttpUrl("http://localhost/admin", options(dnsNotCalled))).rejects.toMatchObject({
      errorCode: "blocked_url",
    });
  });

  test("allows a public address and a name that resolves publicly", async () => {
    const literal = await assertSafeHttpUrl("http://1.1.1.1/a", options(dnsNotCalled));
    expect(literal.hostname).toBe("1.1.1.1");
    const named = await assertSafeHttpUrl("https://example.com/a", options(async (host) => {
      expect(host).toBe("example.com");
      return ["93.184.216.34"];
    }));
    expect(named.href).toBe("https://example.com/a");
  });

  test("blocks a name when any resolved address is non-public", async () => {
    await expect(assertSafeHttpUrl("https://rebind.example/", options(async () => ["1.1.1.1", "10.0.0.1"])))
      .rejects.toMatchObject({ errorCode: "blocked_url" });
    await expect(assertSafeHttpUrl("https://missing.example/", options(async () => [])))
      .rejects.toMatchObject({ errorCode: "dns_error" });
  });

  test("allowPrivate skips host checks but still rejects credentials and other protocols", async () => {
    const url = await assertSafeHttpUrl("http://localhost:3000/x", options(dnsNotCalled, true));
    expect(url.hostname).toBe("localhost");
    await expect(assertSafeHttpUrl("http://user:pw@127.0.0.1/", options(dnsNotCalled, true))).rejects.toMatchObject({
      errorCode: "invalid_url",
    });
    await expect(assertSafeHttpUrl("ftp://127.0.0.1/", options(dnsNotCalled, true))).rejects.toMatchObject({
      errorCode: "invalid_url",
    });
  });
});
