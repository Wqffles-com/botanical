import {
  assertVersion,
  claudeRegistryUrl,
  codexPlatformVersion,
  codexRegistryUrl,
  codexTriple,
  cpuArch,
  extractTarFile,
  grokDownloadUrls,
  GROK_VERSION_URL,
  isGzip,
  isUstar,
  listTarNames,
  machineArch,
  pickCliBinary,
  redactSecrets,
  sriMatchesBase64,
  type CpuArch,
  type Libc,
  type MachineArch,
  type RandomAccess,
} from "./artifact.ts";
import { clearCliAvailabilityCache } from "./availability.ts";
import { installChildEnv } from "./child-env.ts";
import { CLI_NAMES, type CliName } from "./types.ts";

export const CLI_ROOT_ENV = "BOTANICAL_CLI_BIN";
export const CLI_HOME_ENV = "BOTANICAL_CLI_HOME";
export const DEFAULT_CLI_ROOT = "/opt/botanical-cli";
export const DEFAULT_CLI_HOME = "/home/botanical";

const PIN_ENV: Record<CliName, string> = {
  grok: "BOTANICAL_GROK_VERSION",
  claude: "BOTANICAL_CLAUDE_VERSION",
  codex: "BOTANICAL_CODEX_VERSION",
};

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export type CliInstallState = "not_installed" | "installing" | "installed" | "failed";

export interface CliManifest {
  cli: CliName;
  version: string;
  arch: MachineArch;
  libc: Libc;
  sourceUrl: string;
  sha512: string | null;
  verified: "sha512" | "version-probe";
  installedAt: string;
}

export interface InstallResult {
  cli: CliName;
  ok: boolean;
  skipped: boolean;
  version: string | null;
  error: string | null;
}

export interface InstallView {
  cli: CliName;
  status: CliInstallState;
  version: string | null;
  arch: string | null;
  lastError: string | null;
  logTail: string | null;
}

export interface InstallIo {
  fetchText(url: string): Promise<{ status: number; text: string }>;
  fetchJson(url: string): Promise<{ status: number; body: unknown }>;
  /** Writes the response body to `dest`. `sha512B64` is the digest of those bytes. */
  download(url: string, dest: string): Promise<{ status: number; sha512B64: string; bytes: number }>;
  gunzip(src: string, dest: string): Promise<void>;
  size(path: string): Promise<number>;
  readAt(path: string, offset: number, length: number): Promise<Uint8Array>;
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array, mode?: number): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): boolean;
  spawn(
    bin: string,
    args: readonly string[],
    env: Record<string, string | undefined>,
    timeoutMs: number,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  arch(): CpuArch;
  libc(): Libc;
  env: Record<string, string | undefined>;
  now(): Date;
}

interface ResolvedArtifact {
  version: string;
  sourceUrl: string;
  integrity: string | null;
  kind: "binary" | "npm-tarball";
  urls: string[];
}

export function cliRootFrom(env: Record<string, string | undefined>): string {
  return env[CLI_ROOT_ENV]?.trim() || DEFAULT_CLI_ROOT;
}

export function cliHomeFrom(env: Record<string, string | undefined>): string {
  return env[CLI_HOME_ENV]?.trim() || env.HOME?.trim() || DEFAULT_CLI_HOME;
}

export function readVersionPin(cli: CliName, env: Record<string, string | undefined>): string | null {
  const raw = env[PIN_ENV[cli]]?.trim() ?? "";
  if (!raw) return null;
  return assertVersion(raw);
}

export function isCliName(value: string): value is CliName {
  return (CLI_NAMES as readonly string[]).includes(value);
}

export class CliInstaller {
  private readonly inflight = new Map<CliName, Promise<InstallResult>>();
  private readonly errors = new Map<CliName, string>();
  private readonly logs = new Map<CliName, string>();
  private readonly phase = new Map<CliName, "installing">();

  constructor(
    private readonly io: InstallIo,
    private readonly paths: { root: string; home: string },
  ) {}

  install(cli: CliName, options?: { update?: boolean }): Promise<InstallResult> {
    const existing = this.inflight.get(cli);
    if (existing) return existing;
    const run = this.execute(cli, options?.update === true).finally(() => {
      if (this.inflight.get(cli) === run) this.inflight.delete(cli);
    });
    this.inflight.set(cli, run);
    return run;
  }

  async installMany(clis: readonly CliName[], options?: { update?: boolean }): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    for (const cli of clis) {
      try {
        results.push(await this.install(cli, options));
      } catch (error) {
        const message = sanitizeError(error);
        this.errors.set(cli, message);
        results.push({ cli, ok: false, skipped: false, version: null, error: message });
      }
    }
    return results;
  }

  async view(cli: CliName): Promise<InstallView> {
    const manifest = await this.readManifest(cli);
    const bin = this.binPath(cli);
    const installed = manifest !== null && this.io.exists(bin);
    let status: CliInstallState;
    if (this.phase.get(cli) === "installing") status = "installing";
    else if (installed) status = "installed";
    else if (this.errors.get(cli)) status = "failed";
    else status = "not_installed";
    return {
      cli,
      status,
      version: manifest?.version ?? null,
      arch: manifest?.arch ?? null,
      lastError: this.errors.get(cli) ?? null,
      logTail: this.logs.get(cli) ?? null,
    };
  }

  binPath(cli: CliName): string {
    return `${this.paths.root}/bin/${cli}`;
  }

  private async execute(cli: CliName, update: boolean): Promise<InstallResult> {
    let scratch: string | null = null;
    try {
      const pin = readVersionPin(cli, this.io.env);
      const manifest = await this.readManifest(cli);
      const arch = machineArch(this.io.arch());
      const libc = this.io.libc();
      if (this.canSkip(update, pin, manifest, arch, libc)) {
        return { cli, ok: true, skipped: true, version: manifest?.version ?? null, error: null };
      }
      this.phase.set(cli, "installing");
      scratch = `${this.paths.root}/tmp/${cli}-${Date.now().toString(36)}`;
      const resolved = await this.resolve(cli, pin);
      if (
        manifest &&
        manifest.version === resolved.version &&
        manifest.arch === arch &&
        manifest.libc === libc &&
        this.io.exists(this.binPath(cli))
      ) {
        return { cli, ok: true, skipped: true, version: manifest.version, error: null };
      }
      await this.io.mkdir(`${this.paths.root}/bin`);
      await this.io.mkdir(scratch);
      const placed = await this.fetchArtifact(cli, resolved, scratch, arch, pin);
      const staged = `${scratch}/bin`;
      await this.placeBinary(placed.payload, staged);
      await this.probe(cli, staged);
      await this.io.mkdir(`${this.paths.root}/bin`);
      await this.io.rename(staged, this.binPath(cli));
      const record: CliManifest = {
        cli,
        version: resolved.version,
        arch,
        libc,
        sourceUrl: placed.sourceUrl,
        sha512: placed.sha512,
        verified: placed.sha512 ? "sha512" : "version-probe",
        installedAt: this.io.now().toISOString(),
      };
      await this.writeManifest(record);
      if (cli === "claude" && libc === "musl") await this.ensureClaudeRipgrep();
      this.errors.delete(cli);
      this.logs.set(cli, `installed ${cli} ${resolved.version} (${arch}, ${libc})`);
      clearCliAvailabilityCache();
      return { cli, ok: true, skipped: false, version: resolved.version, error: null };
    } catch (error) {
      const message = sanitizeError(error);
      this.errors.set(cli, message);
      this.logs.set(cli, message);
      return { cli, ok: false, skipped: false, version: null, error: message };
    } finally {
      this.phase.delete(cli);
      if (scratch) await this.io.remove(scratch);
    }
  }

  private canSkip(
    update: boolean,
    pin: string | null,
    manifest: CliManifest | null,
    arch: MachineArch,
    libc: Libc,
  ): boolean {
    if (!manifest) return false;
    if (manifest.arch !== arch || manifest.libc !== libc) return false;
    if (!this.io.exists(this.binPath(manifest.cli))) return false;
    if (pin) return manifest.version === pin;
    return !update;
  }

  private async resolve(cli: CliName, pin: string | null): Promise<ResolvedArtifact> {
    if (cli === "grok") {
      const version = pin ?? assertVersion(await this.fetchGrokVersion());
      return {
        version,
        sourceUrl: grokDownloadUrls(version, machineArch(this.io.arch()))[0] ?? GROK_VERSION_URL,
        integrity: null,
        kind: "binary",
        urls: grokDownloadUrls(version, machineArch(this.io.arch())),
      };
    }
    if (cli === "claude") {
      const version = pin ?? (await this.fetchNpmVersion("https://registry.npmjs.org/@anthropic-ai/claude-code/latest"));
      const metaUrl = claudeRegistryUrl(this.io.arch(), this.io.libc(), version);
      const dist = await this.fetchDist(metaUrl, cli, version, pin);
      return { version, sourceUrl: dist.tarball, integrity: dist.integrity, kind: "npm-tarball", urls: [dist.tarball] };
    }
    const version = pin ?? (await this.fetchNpmVersion("https://registry.npmjs.org/@openai/codex/latest"));
    const platform = codexPlatformVersion(version, this.io.arch());
    const dist = await this.fetchDist(codexRegistryUrl(platform), cli, version, pin);
    return {
      version: assertVersion(version),
      sourceUrl: dist.tarball,
      integrity: dist.integrity,
      kind: "npm-tarball",
      urls: [dist.tarball],
    };
  }

  private async fetchGrokVersion(): Promise<string> {
    const response = await this.io.fetchText(GROK_VERSION_URL);
    if (response.status !== 200) throw new Error(`Grok version lookup failed (${response.status})`);
    return assertVersion(response.text);
  }

  private async fetchNpmVersion(url: string): Promise<string> {
    const response = await this.io.fetchJson(url);
    if (response.status !== 200) throw new Error(`Version lookup failed (${response.status})`);
    const version = readStringField(response.body, "version");
    if (!version) throw new Error("Version lookup returned no version");
    return assertVersion(version);
  }

  private async fetchDist(
    url: string,
    cli: CliName,
    version: string,
    pin: string | null,
  ): Promise<{ tarball: string; integrity: string }> {
    const response = await this.io.fetchJson(url);
    if (response.status === 404) throw new Error(missingVersion(cli, version, pin, "npm"));
    if (response.status !== 200) throw new Error(`Package metadata failed (${response.status})`);
    const dist = readDist(response.body);
    if (!dist) throw new Error("Package metadata is missing dist.tarball or dist.integrity");
    return dist;
  }

  private async fetchArtifact(
    cli: CliName,
    resolved: ResolvedArtifact,
    scratch: string,
    arch: MachineArch,
    pin: string | null,
  ): Promise<{ payload: string; sourceUrl: string; sha512: string | null }> {
    let last = "download failed";
    let notFound = 0;
    let attempts = 0;
    for (const url of resolved.urls) {
      const dest = `${scratch}/download`;
      let downloaded: { status: number; sha512B64: string; bytes: number };
      try {
        downloaded = await this.io.download(url, dest);
      } catch (error) {
        last = sanitizeError(error);
        continue;
      }
      attempts += 1;
      if (downloaded.status === 404) {
        notFound += 1;
        last = missingVersion(cli, resolved.version, pin, "artifact");
        continue;
      }
      if (downloaded.status !== 200) {
        last = `download failed (${downloaded.status})`;
        continue;
      }
      if (downloaded.bytes <= 0 || downloaded.bytes > MAX_DOWNLOAD_BYTES) {
        throw new Error("Download size is outside the allowed range");
      }
      if (resolved.integrity && !sriMatchesBase64(downloaded.sha512B64, resolved.integrity)) {
        throw new Error(`Integrity check failed for ${cli}`);
      }
      try {
        const payload = await this.materialize(cli, dest, scratch, arch);
        return {
          payload,
          sourceUrl: url,
          sha512: resolved.integrity ? downloaded.sha512B64 : null,
        };
      } catch (error) {
        last = sanitizeError(error);
      }
    }
    if (attempts > 0 && notFound === attempts) {
      throw new Error(missingVersion(cli, resolved.version, pin, "artifact"));
    }
    throw new Error(last);
  }

  private async materialize(cli: CliName, download: string, scratch: string, arch: MachineArch): Promise<string> {
    const head = await this.io.readAt(download, 0, 512);
    const payload = `${scratch}/payload`;
    if (isGzip(head)) await this.io.gunzip(download, payload);
    else await this.copyBytes(download, payload);
    const uncompressed = await this.io.readAt(payload, 0, 512);
    if (!isUstar(uncompressed)) return payload;
    const size = await this.io.size(payload);
    const access: RandomAccess = {
      size,
      readAt: (offset, length) => this.io.readAt(payload, offset, length),
    };
    const names = await listTarNames(access);
    const triple = codexTriple(cpuArch(arch === "aarch64" ? "arm64" : "x64"));
    const member = pickCliBinary(names, cli, triple);
    if (!member) throw new Error(`Archive for ${cli} does not contain the binary`);
    const extracted = `${scratch}/extracted`;
    const chunks: Uint8Array[] = [];
    const ok = await extractTarFile(access, member, async (chunk) => {
      chunks.push(chunk);
    });
    if (!ok) throw new Error(`Archive for ${cli} does not contain ${member}`);
    const bytes = concat(chunks);
    await this.io.write(extracted, bytes, 0o755);
    return extracted;
  }

  private async copyBytes(src: string, dest: string): Promise<void> {
    const size = await this.io.size(src);
    const data = await this.io.readAt(src, 0, size);
    await this.io.write(dest, data, 0o755);
  }

  private async placeBinary(src: string, dest: string): Promise<void> {
    const size = await this.io.size(src);
    if (size <= 0) throw new Error("Installer produced an empty binary");
    const data = await this.io.readAt(src, 0, size);
    await this.io.write(dest, data, 0o755);
  }

  private async probe(cli: CliName, bin: string): Promise<void> {
    const env = childEnv(this.io.env, this.paths.home, this.paths.root, cli);
    const result = await this.io.spawn(bin, ["--version"], env, 20_000);
    if (result.code !== 0) {
      const tail = redactSecrets(`${result.stderr}\n${result.stdout}`).trim().slice(-300);
      throw new Error(tail ? `${cli} --version failed: ${tail}` : `${cli} --version failed`);
    }
  }

  private async ensureClaudeRipgrep(): Promise<void> {
    const dir = `${this.paths.home}/.claude`;
    const path = `${dir}/settings.json`;
    await this.io.mkdir(dir);
    let current: Record<string, unknown> = {};
    const existing = await this.io.read(path);
    if (existing) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(existing)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
      } catch {
        current = {};
      }
    }
    const env =
      current.env && typeof current.env === "object" && !Array.isArray(current.env)
        ? { ...(current.env as Record<string, unknown>) }
        : {};
    env.USE_BUILTIN_RIPGREP = "0";
    current.env = env;
    await this.io.write(path, new TextEncoder().encode(`${JSON.stringify(current, null, 2)}\n`), 0o600);
  }

  private manifestPath(cli: CliName): string {
    return `${this.paths.root}/manifests/${cli}.json`;
  }

  private async readManifest(cli: CliName): Promise<CliManifest | null> {
    const bytes = await this.io.read(this.manifestPath(cli));
    if (!bytes) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CliManifest>;
      if (parsed.cli !== cli || typeof parsed.version !== "string") return null;
      if (parsed.arch !== "x86_64" && parsed.arch !== "aarch64") return null;
      if (parsed.libc !== "musl" && parsed.libc !== "glibc") return null;
      return {
        cli,
        version: parsed.version,
        arch: parsed.arch,
        libc: parsed.libc,
        sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "",
        sha512: typeof parsed.sha512 === "string" ? parsed.sha512 : null,
        verified: parsed.verified === "sha512" ? "sha512" : "version-probe",
        installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "",
      };
    } catch {
      return null;
    }
  }

  private async writeManifest(manifest: CliManifest): Promise<void> {
    const dir = `${this.paths.root}/manifests`;
    await this.io.mkdir(dir);
    const dest = this.manifestPath(manifest.cli);
    const tmp = `${dest}.tmp`;
    await this.io.write(tmp, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), 0o644);
    await this.io.rename(tmp, dest);
  }
}

export function childEnv(
  env: Record<string, string | undefined>,
  home: string,
  root: string,
  cli: CliName,
): Record<string, string> {
  return installChildEnv(env, home, root, cli);
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function readDist(value: unknown): { tarball: string; integrity: string } | null {
  if (!value || typeof value !== "object") return null;
  const dist = (value as { dist?: unknown }).dist;
  if (!dist || typeof dist !== "object") return null;
  const tarball = (dist as { tarball?: unknown }).tarball;
  const integrity = (dist as { integrity?: unknown }).integrity;
  if (typeof tarball !== "string" || typeof integrity !== "string") return null;
  if (!tarball.startsWith("https://")) return null;
  return { tarball, integrity };
}

function missingVersion(cli: CliName, version: string, pin: string | null, source: "npm" | "artifact"): string {
  const where = source === "npm" ? "not found on npm" : "not found";
  const pinText = pin ? ` (${PIN_ENV[cli]})` : "";
  return `${cli} ${version} ${where}${pinText}`;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "install failed";
  return redactSecrets(message).replace(/\s+/g, " ").trim().slice(0, 400) || "install failed";
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
