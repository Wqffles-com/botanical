#!/usr/bin/env node
/**
 * Botanical v0 smoke / e2e entry.
 *
 * Default: boot the in-process mock API and run the golden path.
 * Compose or a packages/server process can be targeted instead.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";
import { assistantTextFromSse, runScenario } from "./scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const DEFAULT_PASSCODE = "botanical-smoke";

export function parseArgs(argv, env = process.env) {
  const options = {
    boot: env.BOTANICAL_SMOKE_BOOT || "mock",
    assume: false,
    composeUp: false,
    selfTest: false,
    help: false,
    bootExplicit: false,
    timeoutMs: numberFromEnv(env, "BOTANICAL_SMOKE_TIMEOUT_MS", 20000),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--assume") options.assume = true;
    else if (arg === "--compose-up") options.composeUp = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--boot") {
      options.boot = requiredValue(argv, ++index, "--boot");
      options.bootExplicit = true;
    } else if (arg.startsWith("--boot=")) {
      options.boot = arg.slice("--boot=".length);
      options.bootExplicit = true;
    } else if (arg === "--timeout") {
      options.timeoutMs = Number(requiredValue(argv, ++index, "--timeout"));
    } else {
      throw new Error(`Unknown argument ${arg}. Run with --help.`);
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number of milliseconds.");
  }
  if (options.assume && options.bootExplicit) {
    throw new Error("Use either --assume or --boot, not both.");
  }
  if (options.assume && options.composeUp) {
    throw new Error("Use either --assume or --compose-up, not both.");
  }
  if (options.composeUp && options.bootExplicit && options.boot !== "compose") {
    throw new Error("--compose-up starts Compose. Drop --boot, or pass --boot compose.");
  }
  if (options.composeUp) options.boot = "compose";
  else if (options.assume) options.boot = "assume";
  if (!["mock", "server", "compose", "assume"].includes(options.boot)) {
    throw new Error("--boot must be mock, server, or compose.");
  }
  return options;
}

function selfTest() {
  const text = assistantTextFromSse(
    'data: {"type":"text-delta","text":"hel"}\n\ndata: {"text":"lo"}\n\ndata: [DONE]\n\n',
  );
  if (text !== "hello") {
    throw new Error(`SSE parser expected hello, got ${JSON.stringify(text)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }
  if (options.selfTest) {
    selfTest();
    console.log("PASS sse parser");
    return 0;
  }
  selfTest();

  const passcode =
    process.env.BOTANICAL_PASSCODE || process.env.BOTANICAL_PASSWORD || "";
  const prefix = process.env.BOTANICAL_API_PREFIX || "";
  const managed = await bootTarget(options, passcode);
  const effectivePasscode = managed.passcode;
  const sendMessage = shouldSendMessage(managed.mode);

  console.log("Botanical v0 smoke");
  console.log(`target: ${managed.baseUrl} (${managed.mode})`);
  try {
    const result = await runScenario({
      baseUrl: managed.baseUrl,
      prefix,
      passcode: effectivePasscode,
      strict: managed.mode === "mock",
      sendMessage,
      timeoutMs: Math.min(options.timeoutMs, 10000),
    });
    printResult(result);
    if (!result.ok && managed.logs) {
      console.error("--- server log ---");
      console.error(managed.logs().slice(-4000));
    }
    return result.ok ? 0 : 1;
  } finally {
    await managed.close();
  }
}

async function bootTarget(options, envPasscode) {
  if (options.boot === "mock") {
    const passcode = envPasscode || DEFAULT_PASSCODE;
    const server = await startMockServer({
      port: 0,
      passcode,
      deploymentMode: process.env.DEPLOYMENT_MODE,
    });
    return {
      mode: "mock",
      baseUrl: server.url,
      passcode,
      close: () => server.close(),
    };
  }

  if (!envPasscode) {
    throw new Error(
      "Set BOTANICAL_PASSCODE (or BOTANICAL_PASSWORD) to the running server passcode.",
    );
  }

  if (options.boot === "compose" && options.composeUp) {
    await composeUp(repoRoot, options.timeoutMs);
  }

  if (options.boot === "assume" || options.boot === "compose") {
    const baseUrl = defaultExternalUrl();
    await waitForHealth(baseUrl, process.env.BOTANICAL_API_PREFIX || "", options.timeoutMs);
    return {
      mode: options.boot,
      baseUrl,
      passcode: envPasscode,
      close: async () => {},
    };
  }

  const launch = resolveServerLaunch(repoRoot);
  if (!launch) {
    throw new Error(
      "packages/server has no start script or entry file yet. Run without flags to use the mock API, or pass --assume once Compose is up.",
    );
  }
  const port = await freePort();
  const child = spawnServer(launch, port, envPasscode);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, process.env.BOTANICAL_API_PREFIX || "", options.timeoutMs);
  } catch (error) {
    const logs = child.logs();
    await child.close();
    throw new Error(`${error.message}\n${logs.slice(-4000)}`);
  }
  return {
    mode: "server",
    baseUrl,
    passcode: envPasscode,
    logs: child.logs,
    close: child.close,
  };
}

function spawnServer(launch, port, passcode) {
  const chunks = [];
  const child = spawn(launch.cmd, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      PORT: String(port),
      BOTANICAL_PORT: String(port),
      HOST: "127.0.0.1",
      BOTANICAL_HOST: "127.0.0.1",
      BOTANICAL_PASSCODE: passcode,
      BOTANICAL_PASSWORD: passcode,
      BOTANICAL_MOCK_PROVIDER: "1",
      DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE || "self_host",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const collect = (stream) => {
    stream.on("data", (chunk) => {
      chunks.push(chunk);
      let total = chunks.reduce((sum, part) => sum + part.length, 0);
      while (total > 65536 && chunks.length > 1) total -= chunks.shift().length;
    });
  };
  collect(child.stdout);
  collect(child.stderr);
  return {
    logs: () => Buffer.concat(chunks).toString("utf8"),
    close() {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          killGroup(child, "SIGKILL");
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        killGroup(child, "SIGTERM");
      });
    },
  };
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already exited */
    }
  }
}

function resolveServerLaunch(root) {
  const serverDir = path.join(root, "packages/server");
  const pkgPath = path.join(serverDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const script = pkg.scripts?.start ? "start" : pkg.scripts?.dev ? "dev" : "";
    if (script) {
      const cmd = hasBin("bun") ? "bun" : "npm";
      return { cmd, args: ["run", script], cwd: serverDir };
    }
  }
  const candidates = [
    "packages/server/src/index.ts",
    "packages/server/src/main.ts",
    "packages/server/src/server.ts",
    "packages/server/index.ts",
    "packages/server/src/index.js",
    "packages/server/index.js",
  ];
  for (const relative of candidates) {
    if (!fs.existsSync(path.join(root, relative))) continue;
    if (relative.endsWith(".ts")) {
      if (hasBin("bun")) return { cmd: "bun", args: [path.join(root, relative)], cwd: root };
      if (hasBin("node")) {
        return {
          cmd: "node",
          args: ["--experimental-strip-types", path.join(root, relative)],
          cwd: root,
        };
      }
    }
    return { cmd: "node", args: [path.join(root, relative)], cwd: root };
  }
  return null;
}

function composeUp(root, timeoutMs) {
  const composeFile = ["docker-compose.yml", "compose.yml"]
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!composeFile) {
    throw new Error(
      "No docker-compose.yml or compose.yml at the repo root. Start the stack yourself and rerun with --assume.",
    );
  }
  if (!hasBin("docker")) throw new Error("docker is not on PATH.");
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "up", "-d", "--wait"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("docker compose up --wait timed out."));
    }, Math.max(timeoutMs, 120000));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `docker compose up exited ${code}: ${Buffer.concat(chunks).toString("utf8").slice(-2000)}`,
          ),
        );
      }
    });
  });
}

async function waitForHealth(baseUrl, prefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(joinHealth(baseUrl, prefix), {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      last = `HTTP ${response.status}`;
      await response.arrayBuffer();
    } catch (error) {
      last = error instanceof Error ? error.name === "TimeoutError" ? "timed out" : error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${joinHealth(baseUrl, prefix)} (${last}). For Compose, run docker compose up -d and see docs/TESTING.md.`,
  );
}

function joinHealth(baseUrl, prefix) {
  const base = baseUrl.replace(/\/+$/, "");
  const cleanPrefix = prefix ? `/${prefix.replace(/^\/+|\/+$/g, "")}` : "";
  return `${base}${cleanPrefix}/health`;
}

function defaultExternalUrl() {
  if (process.env.BOTANICAL_BASE_URL) return process.env.BOTANICAL_BASE_URL.replace(/\/+$/, "");
  const port = process.env.BOTANICAL_PORT || process.env.PORT || "8787";
  return `http://127.0.0.1:${port}`;
}

function shouldSendMessage(mode) {
  if (mode === "mock" || mode === "server") return true;
  if (process.env.BOTANICAL_SMOKE_SEND_MESSAGE === "1") return true;
  if (process.env.BOTANICAL_MOCK_PROVIDER === "1") return true;
  return false;
}

function printResult(result) {
  for (const step of result.steps) {
    const label = step.status.toUpperCase();
    const line = step.detail ? `${label} ${step.name} — ${step.detail}` : `${label} ${step.name}`;
    if (step.status === "fail") console.error(line);
    else console.log(line);
  }
  const passed = result.steps.filter((step) => step.status === "pass").length;
  const skipped = result.steps.filter((step) => step.status === "skip").length;
  const failed = result.steps.filter((step) => step.status === "fail").length;
  const summary = `${result.ok ? "OK" : "FAILED"} ${passed} passed, ${skipped} skipped, ${failed} failed`;
  if (result.ok) console.log(summary);
  else console.error(summary);
}

function helpText() {
  return `Botanical v0 smoke harness

Usage:
  node scripts/smoke/run.mjs
  node scripts/smoke/run.mjs --assume
  node scripts/smoke/run.mjs --boot server
  node scripts/smoke/run.mjs --boot compose --compose-up

Options:
  --boot mock|server|compose   How to reach an API (default: mock)
  --assume                     Use BOTANICAL_BASE_URL; do not boot anything
  --compose-up                 Run docker compose up -d --wait before the scenario
  --timeout <ms>               How long to wait for /health (default 20000)
  --self-test                  Check the SSE parser and exit
  -h, --help                   Show this help

The default boot is an in-process mock on 127.0.0.1. It implements health,
passcode auth, agents, and chats, and answers messages with a mock provider.
See docs/TESTING.md.
`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function hasBin(name) {
  try {
    execFileSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function numberFromEnv(env, name, fallback) {
  if (!env[name]) return fallback;
  return Number(env[name]);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`FAIL harness — ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
