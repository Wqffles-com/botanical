import { createHash, timingSafeEqual } from "node:crypto";

import type { CliName } from "./types.ts";

export type CpuArch = "x64" | "arm64";
export type Libc = "musl" | "glibc";
export type MachineArch = "x86_64" | "aarch64";

export const GROK_VERSION_URL = "https://x.ai/cli/stable";
export const GROK_DOWNLOAD_BASES = [
  "https://x.ai/cli",
  "https://storage.googleapis.com/grok-build-public-artifacts/cli",
] as const;

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9._-]+)?$/;

export function cpuArch(arch: string = process.arch): CpuArch {
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  if (arch === "x64" || arch === "x86_64" || arch === "amd64") return "x64";
  throw new Error(`Unsupported CPU architecture ${arch}`);
}

export function machineArch(cpu: CpuArch): MachineArch {
  return cpu === "arm64" ? "aarch64" : "x86_64";
}

/**
 * Alpine (and other musl images) advertise themselves with `/etc/alpine-release`
 * or a musl `ldd`. Callers pass the probe text so tests do not touch the host.
 */
export function detectLibc(input: { alpineRelease: boolean; lddText?: string; reportText?: string }): Libc {
  if (input.alpineRelease) return "musl";
  const blob = `${input.lddText ?? ""}\n${input.reportText ?? ""}`.toLowerCase();
  if (blob.includes("musl")) return "musl";
  return "glibc";
}

export function assertVersion(version: string): string {
  const text = version.trim();
  if (text.includes("..") || text.includes("/") || text.includes("\\") || !VERSION_RE.test(text)) {
    throw new Error(`Refusing CLI version ${JSON.stringify(version)}`);
  }
  return text;
}

export function grokDownloadUrls(version: string, arch: MachineArch): string[] {
  const name = `grok-${assertVersion(version)}-linux-${arch}`;
  const urls: string[] = [];
  for (const base of GROK_DOWNLOAD_BASES) {
    urls.push(`${base}/${name}.gz`, `${base}/${name}`);
  }
  return urls;
}

/** npm optional package that ships the Claude Code native binary. */
export function claudePackageName(cpu: CpuArch, libc: Libc): string {
  const suffix = libc === "musl" ? "-musl" : "";
  return `@anthropic-ai/claude-code-linux-${cpu}${suffix}`;
}

export function claudeRegistryUrl(cpu: CpuArch, libc: Libc, version: string): string {
  return `https://registry.npmjs.org/${claudePackageName(cpu, libc)}/${assertVersion(version)}`;
}

export function codexTriple(cpu: CpuArch): string {
  return cpu === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
}

/** Platform build published as `@openai/codex@<version>-linux-<cpu>`. */
export function codexPlatformVersion(version: string, cpu: CpuArch): string {
  const text = assertVersion(version);
  if (text.endsWith(`-linux-${cpu}`)) return text;
  return `${text}-linux-${cpu}`;
}

export function codexRegistryUrl(version: string): string {
  return `https://registry.npmjs.org/@openai/codex/${assertVersion(version)}`;
}

export function verifySha512Sri(bytes: Uint8Array, integrity: string): boolean {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity.trim());
  const b64 = match?.[1];
  if (!b64) return false;
  const actual = createHash("sha512").update(bytes).digest();
  let expected: Buffer;
  try {
    expected = Buffer.from(b64, "base64");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

export function sha512Base64(bytes: Uint8Array): string {
  return createHash("sha512").update(bytes).digest("base64");
}

export function sriMatchesBase64(downloadB64: string, integrity: string): boolean {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity.trim());
  const expected = match?.[1];
  if (!expected) return false;
  const actual = Buffer.from(downloadB64);
  const want = Buffer.from(expected);
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isUstar(bytes: Uint8Array): boolean {
  if (bytes.length < 262) return false;
  const magic = Buffer.from(bytes.subarray(257, 262)).toString("utf8");
  return magic === "ustar";
}

const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|\([A-Z])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Redact credential-shaped strings. Short device codes (ABCD-EFGH) stay so the
 * UI can show them. Verification URLs are the caller's job to keep intact.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b[a-f0-9]{40,}\b/gi, "[redacted]");
}

export interface LoginHints {
  verificationUrl: string | null;
  userCode: string | null;
  needsInput: boolean;
}

export function parseLoginOutput(raw: string): LoginHints {
  const text = stripAnsi(raw);
  return {
    verificationUrl: extractUrl(text),
    userCode: extractUserCode(text),
    needsInput: /paste (?:the |a )?(?:code|token)|enter the token|paste code here|setup-token/i.test(text),
  };
}

function extractUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"'`)\]]+/g) ?? [];
  const cleaned = matches.map((url) => url.replace(/[.,;]+$/g, ""));
  const preferred = cleaned.find((url) => /device|login|oauth|auth|verify|claude\.ai|anthropic|openai\.com|x\.ai/i.test(url));
  return preferred ?? cleaned[0] ?? null;
}

function extractUserCode(text: string): string | null {
  const labeled = text.match(
    /(?:one-time code|enter this code|then enter this code|user code|code)\s*[:\s]*([A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})+)/i,
  );
  if (labeled?.[1]) return labeled[1];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,2}$/.test(trimmed)) return trimmed;
  }
  return null;
}

/** A line that is itself a long token, not a device code or a URL. */
export function extractPastedToken(text: string): string | null {
  for (const line of stripAnsi(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("://") || trimmed.includes(" ")) continue;
    if (/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
    if (/^[A-Za-z0-9_-]{40,}$/.test(trimmed) && !/^[a-f0-9]+$/i.test(trimmed)) return trimmed;
  }
  return null;
}

export function fileHasCredential(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length === 0) return false;
  const text = new TextDecoder().decode(bytes).trim();
  return text.length > 0 && text !== "{}" && text !== "null";
}

/** True when Claude's settings env holds a long-lived token. The token is not returned. */
export function settingsHasOauthToken(text: string | null): boolean {
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as { env?: { CLAUDE_CODE_OAUTH_TOKEN?: unknown } };
    const token = parsed.env?.CLAUDE_CODE_OAUTH_TOKEN;
    return typeof token === "string" && token.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Boolean `loggedIn` from `claude auth status` JSON, or null when that field
 * is absent. `~/.claude.json` is not a credential and is ignored here.
 */
export function claudeAuthStatusFlag(stdout: string): boolean | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null;
  } catch {
    return null;
  }
}

/** Parsed `loggedIn` wins. With no JSON boolean, exit code 0 means logged in. */
export function claudeAuthStatusLoggedIn(code: number, stdout: string): boolean {
  const flag = claudeAuthStatusFlag(stdout);
  if (flag !== null) return flag;
  return code === 0;
}

/**
 * Positive signals are an API key, `CLAUDE_CODE_OAUTH_TOKEN`, a settings.json
 * token, or a non-empty `~/.claude/.credentials.json`. Otherwise `authStatus`
 * is authoritative. A bare `~/.claude.json` is not a signal.
 */
/** Non-empty `~/.grok/auth.json`, or a non-empty `XAI_API_KEY`. `grok models` is not a login check. */
export function grokHasLogin(input: { authNonEmpty: boolean; apiKey?: string | null }): boolean {
  if (input.authNonEmpty) return true;
  return (input.apiKey ?? "").trim().length > 0;
}

export function claudeHasLogin(input: {
  apiKey?: string | null;
  oauthToken?: string | null;
  settingsText?: string | null;
  credentialsNonEmpty: boolean;
  authStatus?: { code: number; stdout: string } | null;
}): boolean {
  if ((input.apiKey ?? "").trim() || (input.oauthToken ?? "").trim()) return true;
  if (settingsHasOauthToken(input.settingsText ?? null)) return true;
  if (input.credentialsNonEmpty) return true;
  if (!input.authStatus) return false;
  return claudeAuthStatusLoggedIn(input.authStatus.code, input.authStatus.stdout);
}

export interface RandomAccess {
  size: number;
  readAt(offset: number, length: number): Promise<Uint8Array>;
}

export async function listTarNames(file: RandomAccess): Promise<string[]> {
  const names: string[] = [];
  await walkTar(file, (entry) => {
    if (entry.kind === "file") names.push(entry.name);
  });
  return names;
}

export async function extractTarFile(
  file: RandomAccess,
  name: string,
  write: (chunk: Uint8Array) => Promise<void>,
): Promise<boolean> {
  let found = false;
  await walkTar(file, async (entry) => {
    if (found || entry.kind !== "file" || entry.name !== name) return;
    found = true;
    let remaining = entry.size;
    let offset = entry.dataOffset;
    while (remaining > 0) {
      const n = Math.min(remaining, 1024 * 256);
      const chunk = await file.readAt(offset, n);
      if (chunk.length !== n) throw new Error(`Short read in tar member ${name}`);
      await write(chunk);
      offset += n;
      remaining -= n;
    }
  });
  return found;
}

export function pickCliBinary(names: readonly string[], cli: CliName, triple: string): string | null {
  const files = names.filter((name) => !name.endsWith("/"));
  if (cli === "claude") {
    return (
      files.find((name) => /(^|\/)claude$/.test(name)) ??
      files.find((name) => name.endsWith("/claude")) ??
      null
    );
  }
  if (cli === "codex") {
    const prefer = [
      `vendor/${triple}/bin/codex`,
      `vendor/${triple}/codex/codex`,
      `vendor/${triple}/codex`,
    ];
    for (const suffix of prefer) {
      const hit = files.find((name) => name === suffix || name.endsWith(`/${suffix}`));
      if (hit) return hit;
    }
    return files.find((name) => /(^|\/)codex$/.test(name) && !name.endsWith(".js")) ?? null;
  }
  return files.find((name) => /(^|\/)grok$/.test(name)) ?? null;
}

interface TarEntry {
  name: string;
  kind: "file" | "other";
  size: number;
  dataOffset: number;
}

async function walkTar(file: RandomAccess, visit: (entry: TarEntry) => void | Promise<void>): Promise<void> {
  let offset = 0;
  let pendingName: string | null = null;
  while (offset + 512 <= file.size) {
    const header = await file.readAt(offset, 512);
    if (header.length < 512) break;
    if (isZero(header)) break;
    const size = parseOctal(header.subarray(124, 136));
    const type = header[156] ?? 0;
    const rawName = tarName(header);
    offset += 512;
    const dataOffset = offset;
    const blocks = Math.ceil(size / 512) * 512;
    if (type === 0x4c) {
      const data = await file.readAt(dataOffset, size);
      pendingName = Buffer.from(data).toString("utf8").replace(/\0+$/g, "");
      offset += blocks;
      continue;
    }
    if (type === 0x78 || type === 0x67) {
      offset += blocks;
      pendingName = null;
      continue;
    }
    const name = pendingName ?? rawName;
    pendingName = null;
    const kind = type === 0x30 || type === 0 ? "file" : "other";
    if (name) await visit({ name, kind, size, dataOffset });
    offset += blocks;
  }
}

function tarName(header: Uint8Array): string {
  const name = cString(header.subarray(0, 100));
  const prefix = cString(header.subarray(345, 500));
  if (prefix && name) return `${prefix}/${name}`;
  return name || prefix;
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  return Buffer.from(slice).toString("utf8").trim();
}

function parseOctal(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("utf8").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid tar size");
  return value;
}

function isZero(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte !== 0) return false;
  return true;
}
