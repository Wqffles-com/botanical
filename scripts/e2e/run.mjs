#!/usr/bin/env node
/**
 * Run the Playwright suite against BASE_URL (default http://localhost:3000).
 *
 *   node scripts/e2e/run.mjs
 *   BASE_URL=http://127.0.0.1:3000 BOTANICAL_PASSCODE=botanical node scripts/e2e/run.mjs
 *   node scripts/e2e/run.mjs --self-test
 *
 * The default run does not boot Docker. --self-test starts a local fixture
 * that speaks the same routes, then tears it down.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixture } from "./fixture-server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const e2eDir = path.join(repoRoot, "packages/e2e");
const args = process.argv.slice(2);
const selfTest = args.includes("--self-test");
const forwarded = args.filter((arg) => arg !== "--self-test");

function playwrightBin() {
  const candidates = [
    path.join(repoRoot, "node_modules", ".bin", "playwright"),
    path.join(e2eDir, "node_modules", ".bin", "playwright"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function chromiumReady() {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(browsers)) return false;
  return readdirSync(browsers).some((name) => name.startsWith("chromium"));
}

function run(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: e2eDir, env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function configuredPasscode() {
  return (
    process.env.BOTANICAL_PASSCODE?.trim() ||
    process.env.BOTANICAL_PASSWORD?.trim() ||
    process.env.E2E_PASSCODE?.trim() ||
    "botanical"
  );
}

async function main() {
  const bin = playwrightBin();
  if (!bin) {
    console.error("Playwright is not installed. From the repo root, run: bun install");
    return 1;
  }

  let baseURL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const passcode = configuredPasscode();
  let closeFixture = null;

  if (selfTest) {
    const fixture = await startFixture(passcode);
    baseURL = fixture.url;
    closeFixture = () => fixture.close();
    console.log(`E2E self-test fixture at ${baseURL}`);
  } else {
    const up = await probe(baseURL);
    if (!up) {
      console.error(`E2E target ${baseURL} is not accepting connections.`);
      console.error("Start the MVP web app on port 3000, or run: node scripts/e2e/run.mjs --self-test");
      return 1;
    }
  }

  const env = { ...process.env, BASE_URL: baseURL, BOTANICAL_PASSCODE: passcode };
  let code = 1;
  try {
    if (!chromiumReady()) {
      const installCode = await run(bin, ["install", "chromium"], env);
      if (installCode !== 0) return installCode;
    }
    code = await run(bin, ["test", ...forwarded], env);
  } finally {
    if (closeFixture) await closeFixture();
  }
  return code;
}

const exitCode = await main();
process.exit(exitCode);
