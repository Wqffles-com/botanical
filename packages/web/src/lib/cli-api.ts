import { BotanicalApiError } from "@botanical/core";

export type CliId = "grok" | "claude" | "codex";

export interface CliRow {
  id: string;
  label: string;
  cli: CliId;
  /** A model profile uses this CLI. Installing one that is not enabled adds it to the model list. */
  enabled: boolean;
  status: "not_installed" | "installing" | "installed" | "failed";
  version: string | null;
  arch: string | null;
  loggedIn: boolean | "unknown";
  lastError: string | null;
  logTail: string | null;
}

export interface CliLogin {
  cli: CliId;
  state: "idle" | "pending" | "needs_input" | "done" | "failed" | "expired" | "cancelled";
  verificationUrl: string | null;
  userCode: string | null;
  prompt: string | null;
  error: string | null;
  lines: string[];
}

export async function fetchCliList(): Promise<CliRow[]> {
  const body = await request("/api/cli");
  const clis = record(body).clis;
  if (!Array.isArray(clis)) return [];
  return clis.map(parseRow);
}

export async function installCli(cli: CliId, update: boolean): Promise<CliRow> {
  const body = await request(`/api/cli/${cli}/install`, {
    method: "POST",
    body: JSON.stringify({ update }),
  });
  return parseRow(record(body).cli);
}

export async function startCliLogin(cli: CliId): Promise<CliLogin> {
  const body = await request(`/api/cli/${cli}/login`, { method: "POST" });
  return parseLogin(record(body).login);
}

export async function fetchCliLogin(cli: CliId): Promise<CliLogin> {
  const body = await request(`/api/cli/${cli}/login`);
  return parseLogin(record(body).login);
}

export async function sendCliLoginInput(cli: CliId, input: string): Promise<CliLogin> {
  const body = await request(`/api/cli/${cli}/login/input`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
  return parseLogin(record(body).login);
}

export async function cancelCliLogin(cli: CliId): Promise<CliLogin> {
  const body = await request(`/api/cli/${cli}/login`, { method: "DELETE" });
  return parseLogin(record(body).login);
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const raw = await response.text();
  const body = raw ? parseJson(raw) : null;
  if (!response.ok) {
    throw new BotanicalApiError(readError(body, response.status), { status: response.status, body });
  }
  return body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
  }
  return `Request failed (${status}).`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseRow(value: unknown): CliRow {
  const row = record(value);
  const cli = row.cli === "claude" || row.cli === "codex" || row.cli === "grok" ? row.cli : "grok";
  const status = row.status;
  return {
    id: typeof row.id === "string" ? row.id : cli,
    label: typeof row.label === "string" ? row.label : cli,
    cli,
    enabled: row.enabled !== false,
    status:
      status === "installing" || status === "installed" || status === "failed" || status === "not_installed"
        ? status
        : "not_installed",
    version: typeof row.version === "string" ? row.version : null,
    arch: typeof row.arch === "string" ? row.arch : null,
    loggedIn: row.loggedIn === true || row.loggedIn === false || row.loggedIn === "unknown" ? row.loggedIn : "unknown",
    lastError: typeof row.lastError === "string" ? row.lastError : null,
    logTail: typeof row.logTail === "string" ? row.logTail : null,
  };
}

function parseLogin(value: unknown): CliLogin {
  const row = record(value);
  const cli = row.cli === "claude" || row.cli === "codex" || row.cli === "grok" ? row.cli : "grok";
  const state = row.state;
  const known = ["idle", "pending", "needs_input", "done", "failed", "expired", "cancelled"] as const;
  return {
    cli,
    state: known.includes(state as (typeof known)[number]) ? (state as CliLogin["state"]) : "idle",
    verificationUrl: typeof row.verificationUrl === "string" ? row.verificationUrl : null,
    userCode: typeof row.userCode === "string" ? row.userCode : null,
    prompt: typeof row.prompt === "string" ? row.prompt : null,
    error: typeof row.error === "string" ? row.error : null,
    lines: Array.isArray(row.lines) ? row.lines.filter((line): line is string => typeof line === "string") : [],
  };
}
