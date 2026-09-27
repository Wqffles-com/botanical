import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { cpuArch, detectLibc, type InstallIo } from "@botanical/providers";

const MAX_BYTES = 512 * 1024 * 1024;

export function createNodeInstallIo(env: Record<string, string | undefined>): InstallIo {
  return {
    env,
    now: () => new Date(),
    arch: () => cpuArch(),
    libc: () =>
      detectLibc({
        alpineRelease: existsSync("/etc/alpine-release"),
        lddText: lddVersionText(),
      }),
    async fetchText(url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = response.ok ? (await response.text()).trim() : "";
      return { status: response.status, text };
    },
    async fetchJson(url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return { status: response.status, body: null };
      return { status: response.status, body: (await response.json()) as unknown };
    },
    download: (url, dest) => downloadToFile(url, dest),
    async gunzip(src, dest) {
      const head = await readAt(src, 0, 2);
      if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
        await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
        return;
      }
      const bytes = await readFile(src);
      await writeFile(dest, bytes, { mode: 0o644 });
    },
    async size(path) {
      const info = await stat(path);
      return info.size;
    },
    readAt,
    async read(path) {
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
    async write(path, data, mode = 0o644) {
      await mkdir(parentDir(path), { recursive: true });
      await writeFile(path, data, { mode });
    },
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    async rename(from, to) {
      await mkdir(parentDir(to), { recursive: true });
      await rename(from, to);
    },
    async remove(path) {
      await rm(path, { recursive: true, force: true });
    },
    exists(path) {
      return existsSync(path);
    },
    spawn(bin, args, childEnv, timeoutMs) {
      return spawnProbe(bin, args, childEnv, timeoutMs);
    },
  };
}

async function readAt(path: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, offset);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function downloadToFile(url: string, dest: string): Promise<{ status: number; sha512B64: string; bytes: number }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) {
    return { status: response.status, sha512B64: "", bytes: 0 };
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error("Download is too large");
  }
  await mkdir(parentDir(dest), { recursive: true });
  const hash = createHash("sha512");
  const file = createWriteStream(dest, { mode: 0o644 });
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      bytes += step.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Download is too large");
      hash.update(step.value);
      if (!file.write(step.value)) {
        await new Promise<void>((resolve) => file.once("drain", () => resolve()));
      }
    }
  } finally {
    file.end();
    await new Promise<void>((resolve, reject) => {
      file.once("finish", () => resolve());
      file.once("error", reject);
    });
  }
  return { status: response.status, sha512B64: hash.digest("base64"), bytes };
}

function spawnProbe(
  bin: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      env: definedEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const take = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-4_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = take(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = take(stderr, chunk);
    });
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      killChild(child.pid);
      finish(124);
    }, timeoutMs);
    child.on("error", () => finish(127));
    child.on("exit", (code) => finish(code ?? 1));
  });
}

function killChild(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The process may not be a group leader.
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already exited
  }
}

function definedEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function lddVersionText(): string {
  try {
    return execFileSync("ldd", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") return stderr;
    if (stderr instanceof Uint8Array) return new TextDecoder().decode(stderr);
    return "";
  }
}
