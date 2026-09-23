import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mockCompletion, startMockServer } from "./mock-server.mjs";
import { parseArgs } from "./run.mjs";
import {
  assistantTextFromJson,
  assistantTextFromSse,
  joinUrl,
  runScenario,
} from "./scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const runScript = path.join(repoRoot, "scripts/smoke/run.mjs");

test("parseArgs defaults to the in-process mock", () => {
  assert.equal(parseArgs([], {}).boot, "mock");
  assert.equal(parseArgs(["--assume"], {}).boot, "assume");
  assert.equal(parseArgs(["--boot", "server"], {}).boot, "server");
  assert.equal(parseArgs(["--compose-up"], {}).boot, "compose");
  assert.equal(parseArgs(["--compose-up"], {}).composeUp, true);
  assert.equal(parseArgs([], { BOTANICAL_SMOKE_BOOT: "compose" }).boot, "compose");
  assert.throws(() => parseArgs(["--assume", "--boot", "mock"], {}), /either --assume or --boot/);
  assert.throws(() => parseArgs(["--boot", "server", "--compose-up"], {}), /--compose-up starts Compose/);
});

test("parsers accept JSON content parts and SSE stubs", () => {
  assert.equal(
    assistantTextFromSse(
      'data: {"type":"text-delta","text":"hel"}\n\ndata: {"text":"lo"}\n\ndata: [DONE]\n\n',
    ),
    "hello",
  );
  assert.equal(
    assistantTextFromJson({
      message: { role: "assistant", content: [{ type: "text", text: "pong" }] },
    }),
    "pong",
  );
  assert.equal(joinUrl("http://127.0.0.1:8787/", "/api/", "/health"), "http://127.0.0.1:8787/api/health");
});

test("mock server source stays local and provider-free", () => {
  const source = fs.readFileSync(new URL("./mock-server.mjs", import.meta.url), "utf8");
  assert.match(source, /listen\(options\.port \?\? 0, "127\.0\.0\.1"/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(
    source,
    /api\.openai\.com|api\.anthropic\.com|api\.x\.ai|openrouter\.ai|api\.deepseek\.com/,
  );
});

test("golden path covers health, auth, agent, chat, and mock message", async () => {
  const server = await startMockServer({ passcode: "pw", deploymentMode: "self_host" });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const result = await runScenario({
      baseUrl: server.url,
      passcode: "pw",
      strict: true,
      sendMessage: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.steps, null, 2));
    assert.equal(result.steps.some((step) => step.status === "skip"), false);
    const names = result.steps.map((step) => step.name);
    assert.deepEqual(names, [
      "health",
      "auth rejects missing session",
      "auth rejects bad passcode",
      "auth login",
      "auth me",
      "profiles have no default model",
      "create agent",
      "chat requires a profile",
      "create chat",
      "read agent and chat",
      "mock provider message",
      "auth logout",
    ]);
  } finally {
    await server.close();
  }
});

test("mock API accepts a password field, many agents, and refuses a missing agent", async () => {
  const server = await startMockServer({ passcode: "pw", deploymentMode: "saas" });
  try {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.deploymentMode, "saas");
    assert.equal(healthBody.defaultProfile, null);
    assert.equal(healthBody.mockProvider, true);

    const denied = await fetch(`${server.url}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    assert.equal(denied.status, 401);

    const session = await fetch(`${server.url}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "pw" }),
    });
    assert.equal(session.status, 200);
    const { token } = await session.json();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };

    const missingName = await fetch(`${server.url}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ description: "no name" }),
    });
    assert.equal(missingName.status, 400);

    const first = await createAgent(server.url, headers, "One");
    const second = await createAgent(server.url, headers, "Two");
    assert.notEqual(first.id, second.id);

    const missingAgent = await fetch(`${server.url}/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: "00000000-0000-4000-8000-000000000000",
        profileId: "mock",
      }),
    });
    assert.equal(missingAgent.status, 404);

    const chatA = await createChat(server.url, headers, first.id);
    const chatB = await createChat(server.url, headers, second.id);
    assert.equal(chatA.agentId, first.id);
    assert.equal(chatB.agentId, second.id);
    assert.notEqual(chatA.id, chatB.id);

    const posted = await fetch(`${server.url}/chats/${chatA.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "ping" }),
    });
    assert.equal(posted.status, 200);
    const body = await posted.json();
    assert.equal(body.message.content, mockCompletion("ping").content);
    assert.equal(body.message.provider, "mock");
  } finally {
    await server.close();
  }
});

test("cli mock boot passes and does not print the passcode", () => {
  const secret = "super-secret-smoke-value";
  const result = spawnSync(process.execPath, [runScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: cleanEnv({ BOTANICAL_PASSCODE: secret, DEPLOYMENT_MODE: "self_host" }),
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /OK 12 passed, 0 skipped, 0 failed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret-smoke-value/);
});

test("cli reports a missing server package and a dead assume target", () => {
  const missing = spawnSync(process.execPath, [runScript, "--boot", "server"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: cleanEnv({ BOTANICAL_PASSCODE: "pw" }),
  });
  assert.equal(missing.status, 1);
  assert.match(`${missing.stdout}${missing.stderr}`, /packages\/server/);

  const offline = spawnSync(
    process.execPath,
    [runScript, "--assume", "--timeout", "800"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: cleanEnv({
        BOTANICAL_PASSCODE: "pw",
        BOTANICAL_BASE_URL: "http://127.0.0.1:9",
      }),
    },
  );
  assert.equal(offline.status, 1);
  assert.match(`${offline.stdout}${offline.stderr}`, /Timed out waiting/);
});

async function createAgent(base, headers, name) {
  const response = await fetch(`${base}/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      description: name,
      systemPrompt: "smoke",
      tools: [],
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function createChat(base, headers, agentId) {
  const response = await fetch(`${base}/chats`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId, profileId: "mock", title: nameOf(agentId) }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function nameOf(agentId) {
  return `chat-${agentId.slice(0, 8)}`;
}

function cleanEnv(extra) {
  const env = { ...process.env };
  delete env.BOTANICAL_API_PREFIX;
  delete env.BOTANICAL_SMOKE_BOOT;
  delete env.BOTANICAL_SMOKE_SEND_MESSAGE;
  delete env.BOTANICAL_MOCK_PROVIDER;
  delete env.BOTANICAL_BASE_URL;
  delete env.BOTANICAL_SMOKE_TIMEOUT_MS;
  return { ...env, ...extra };
}
