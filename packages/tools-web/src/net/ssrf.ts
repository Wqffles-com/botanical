import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { ToolCallError } from "../result.ts";
import type { DnsLookup } from "../types.ts";

/**
 * Hosts and addresses `web_fetch` will not contact.
 * The check runs before the connection. A DNS change between this lookup and
 * the socket connect is still possible; the resolved address is not pinned.
 */
const BLOCKED = buildBlocked();

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
]);

export interface SafeUrlOptions {
  allowPrivate: boolean;
  dnsLookup: DnsLookup;
}

export const defaultDnsLookup: DnsLookup = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export function stripIpLiteral(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const zone = host.indexOf("%");
  return zone === -1 ? host : host.slice(0, zone);
}

export function isNonPublicAddress(address: string): boolean {
  const bare = stripIpLiteral(address);
  const kind = isIP(bare);
  if (kind === 4) return BLOCKED.check(bare, "ipv4");
  if (kind === 6) return BLOCKED.check(bare, "ipv6");
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = stripIpLiteral(hostname);
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".metadata.google.internal")) return true;
  return false;
}

export async function assertSafeHttpUrl(raw: string, options: SafeUrlOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolCallError("invalid_url", `Not a valid URL: ${preview(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    const protocol = url.protocol || "no protocol";
    throw new ToolCallError("invalid_url", `Only http and https URLs can be fetched (got ${protocol}).`);
  }
  if (url.username || url.password) {
    throw new ToolCallError("invalid_url", "URLs with embedded credentials are not allowed.");
  }
  if (!url.hostname) {
    throw new ToolCallError("invalid_url", "URL is missing a host.");
  }
  if (options.allowPrivate) return url;

  const literal = stripIpLiteral(url.hostname);
  if (isIP(literal) !== 0) {
    if (isNonPublicAddress(literal)) {
      throw new ToolCallError("blocked_url", `Refusing to fetch non-public address ${literal}.`);
    }
    return url;
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ToolCallError("blocked_url", `Refusing to fetch non-public host ${url.hostname}.`);
  }

  let addresses: readonly string[];
  try {
    addresses = await options.dnsLookup(url.hostname);
  } catch (error) {
    if (error instanceof ToolCallError) throw error;
    const code = errorCode(error);
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
      throw new ToolCallError("dns_error", `Could not resolve host ${url.hostname}.`);
    }
    const reason = error instanceof Error ? error.message : "lookup failed";
    throw new ToolCallError("dns_error", `Could not resolve host ${url.hostname}: ${reason}`);
  }
  if (addresses.length === 0) {
    throw new ToolCallError("dns_error", `Could not resolve host ${url.hostname}.`);
  }
  const privateAddress = addresses.find((address) => isNonPublicAddress(address));
  if (privateAddress) {
    throw new ToolCallError(
      "blocked_url",
      `Refusing to fetch ${url.hostname} because it resolves to non-public address ${privateAddress}.`,
    );
  }
  return url;
}

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim().replace(/\/\/([^/?#\s]*)@/g, "//");
  return collapsed.length <= 120 ? collapsed : `${collapsed.slice(0, 117)}...`;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code);
}

function buildBlocked(): BlockList {
  const list = new BlockList();
  const v4: ReadonlyArray<readonly [string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
  ];
  for (const [ip, bits] of v4) list.addSubnet(ip, bits, "ipv4");
  list.addRange("224.0.0.0", "255.255.255.255", "ipv4");
  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  list.addSubnet("fec0::", 10, "ipv6");
  list.addSubnet("ff00::", 8, "ipv6");
  list.addSubnet("2001:db8::", 32, "ipv6");
  return list;
}
