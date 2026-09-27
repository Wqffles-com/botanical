import {
  extractPastedToken,
  parseLoginOutput,
  redactSecrets,
  stripAnsi,
} from "./artifact.ts";
import { clearCliAvailabilityCache } from "./availability.ts";
import type { CliName } from "./types.ts";

export const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

export const CLAUDE_TOKEN_PROMPT =
  "Run `claude setup-token` on any computer with a browser (or use the terminal command below), then paste the token here. It is stored on the server and is not shown again.";

export type LoginState = "idle" | "pending" | "needs_input" | "done" | "failed" | "expired" | "cancelled";

export interface LoginView {
  cli: CliName;
  state: LoginState;
  verificationUrl: string | null;
  userCode: string | null;
  prompt: string | null;
  error: string | null;
  lines: string[];
}

export interface LoginProcess {
  write(text: string): void;
  kill(): void;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
}

export interface LoginIo {
  spawn(bin: string, args: readonly string[], env: Record<string, string | undefined>): LoginProcess;
  resolveBin(cli: CliName): string | null;
  envFor(cli: CliName): Record<string, string | undefined>;
  isLoggedIn(cli: CliName): Promise<boolean>;
  persistClaudeToken(token: string): Promise<void>;
  timeoutMs?: number;
}

export class LoginBusyError extends Error {
  constructor() {
    super("A login is already running for this CLI");
    this.name = "LoginBusyError";
  }
}

interface Session {
  view: LoginView;
  raw: string;
  process: LoginProcess | null;
  timer: ReturnType<typeof setTimeout> | null;
  generation: number;
  persist: Promise<void>;
}

const LOGIN_ARGS: Record<CliName, readonly string[]> = {
  grok: ["login", "--device-auth"],
  claude: ["setup-token"],
  codex: ["login", "--device-auth"],
};

export class LoginManager {
  private readonly sessions = new Map<CliName, Session>();
  private generation = 0;

  constructor(private readonly io: LoginIo) {}

  view(cli: CliName): LoginView {
    return copyView(this.sessions.get(cli)?.view ?? idle(cli));
  }

  start(cli: CliName): LoginView {
    const current = this.sessions.get(cli);
    if (current && (current.view.state === "pending" || current.view.state === "needs_input")) {
      throw new LoginBusyError();
    }
    const bin = this.io.resolveBin(cli);
    if (!bin) {
      const view: LoginView = { ...idle(cli), state: "failed", error: `${cli} is not installed` };
      this.sessions.set(cli, emptySession(view));
      return copyView(view);
    }
    const generation = ++this.generation;
    const process = this.io.spawn(bin, LOGIN_ARGS[cli], this.io.envFor(cli));
    const view: LoginView = {
      cli,
      state: cli === "claude" ? "needs_input" : "pending",
      verificationUrl: null,
      userCode: null,
      prompt: cli === "claude" ? CLAUDE_TOKEN_PROMPT : null,
      error: null,
      lines: [],
    };
    const session: Session = { view, raw: "", process, timer: null, generation, persist: Promise.resolve() };
    session.timer = setTimeout(() => this.expire(cli, generation), this.io.timeoutMs ?? LOGIN_TIMEOUT_MS);
    process.onData((chunk) => this.consume(cli, generation, chunk));
    process.onExit((code) => {
      void this.finish(cli, generation, code);
    });
    this.sessions.set(cli, session);
    return copyView(view);
  }

  async input(cli: CliName, value: string): Promise<LoginView> {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Login input is empty");
    if (trimmed.length > 4_000) throw new Error("Login input is too long");
    const session = this.sessions.get(cli);
    if (!session || (session.view.state !== "pending" && session.view.state !== "needs_input")) {
      throw new Error("No login is waiting for input");
    }
    if (cli === "claude" && looksLikeClaudeToken(trimmed)) {
      session.persist = session.persist.then(() => this.io.persistClaudeToken(trimmed));
      await session.persist;
      const logged = await this.io.isLoggedIn(cli);
      if (logged) {
        this.stop(session, "done", null);
        clearCliAvailabilityCache();
        return copyView(session.view);
      }
    }
    session.process?.write(`${trimmed}\n`);
    return copyView(session.view);
  }

  cancel(cli: CliName): LoginView {
    const session = this.sessions.get(cli);
    if (!session || (session.view.state !== "pending" && session.view.state !== "needs_input")) {
      return this.view(cli);
    }
    this.stop(session, "cancelled", null);
    return copyView(session.view);
  }

  close(): void {
    for (const session of this.sessions.values()) {
      if (session.view.state === "pending" || session.view.state === "needs_input") {
        this.stop(session, "cancelled", null);
      }
    }
  }

  private consume(cli: CliName, generation: number, chunk: string): void {
    const session = this.sessions.get(cli);
    if (!session || session.generation !== generation) return;
    if (session.view.state !== "pending" && session.view.state !== "needs_input") return;
    session.raw = (session.raw + chunk).slice(-16_000);
    const hints = parseLoginOutput(session.raw);
    if (hints.verificationUrl) session.view.verificationUrl = hints.verificationUrl;
    if (hints.userCode) session.view.userCode = hints.userCode;
    if (cli !== "claude" && hints.needsInput) {
      session.view.state = "needs_input";
      session.view.prompt = "Paste the code from the CLI.";
    }
    session.view.lines = publicLines(session.raw);
    if (cli === "claude") {
      const token = extractPastedToken(session.raw);
      if (token) {
        session.persist = session.persist.then(() => this.io.persistClaudeToken(token));
      }
    }
  }

  private expire(cli: CliName, generation: number): void {
    const session = this.sessions.get(cli);
    if (!session || session.generation !== generation) return;
    if (session.view.state !== "pending" && session.view.state !== "needs_input") return;
    this.stop(session, "expired", "Login timed out");
  }

  private async finish(cli: CliName, generation: number, code: number | null): Promise<void> {
    const session = this.sessions.get(cli);
    if (!session || session.generation !== generation) return;
    if (session.view.state !== "pending" && session.view.state !== "needs_input") return;
    try {
      await session.persist;
    } catch {
      session.view.error = "Could not store the Claude token";
    }
    let logged = false;
    try {
      logged = await this.io.isLoggedIn(cli);
    } catch {
      logged = false;
    }
    if (logged) this.stop(session, "done", null);
    else if (!session.view.error) {
      this.stop(session, "failed", code === 0 ? "Login finished without credentials" : "Login failed");
    } else {
      this.stop(session, "failed", null);
    }
    clearCliAvailabilityCache();
  }

  private stop(session: Session, state: LoginState, error: string | null): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    session.view.state = state;
    if (error && !session.view.error) session.view.error = error;
    const process = session.process;
    session.process = null;
    process?.kill();
  }
}

function idle(cli: CliName): LoginView {
  return {
    cli,
    state: "idle",
    verificationUrl: null,
    userCode: null,
    prompt: null,
    error: null,
    lines: [],
  };
}

function emptySession(view: LoginView): Session {
  return { view, raw: "", process: null, timer: null, generation: 0, persist: Promise.resolve() };
}

function copyView(view: LoginView): LoginView {
  return { ...view, lines: [...view.lines] };
}

function publicLines(raw: string): string[] {
  return stripAnsi(raw)
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (looksLikeClaudeToken(trimmed)) return "[redacted]";
      return redactSecrets(trimmed);
    })
    .filter((line) => line.length > 0)
    .slice(-30)
    .map((line) => line.slice(0, 240));
}

function looksLikeClaudeToken(value: string): boolean {
  if (value.includes(" ") || value.includes("\n") || value.includes("://")) return false;
  return /^sk-ant-[A-Za-z0-9_-]{10,}$/.test(value) || /^[A-Za-z0-9_-]{40,}$/.test(value);
}
