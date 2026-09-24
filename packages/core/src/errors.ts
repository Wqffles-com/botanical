export class BotanicalApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, options: { status: number; body?: unknown }) {
    super(message);
    this.name = "BotanicalApiError";
    this.status = options.status;
    this.body = options.body;
  }
}

/** Thrown when a chat or message would be sent without an explicit model profile. */
export class ProfileRequiredError extends Error {
  readonly code = "profile_required" as const;

  constructor(message = "Choose a model profile for this chat.") {
    super(message);
    this.name = "ProfileRequiredError";
  }
}

/** Thrown when a chat would be created without exactly one agent. */
export class AgentRequiredError extends Error {
  readonly code = "agent_required" as const;

  constructor(message = "Choose one agent for this chat.") {
    super(message);
    this.name = "AgentRequiredError";
  }
}

export function requireProfileId(profileId: string | null | undefined): string {
  const id = profileId?.trim() ?? "";
  if (!id) throw new ProfileRequiredError();
  return id;
}

export function requireAgentId(agentId: string | null | undefined): string {
  const id = agentId?.trim() ?? "";
  if (!id) throw new AgentRequiredError();
  return id;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof BotanicalApiError && (error.status === 401 || error.status === 403);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function errorMessage(body: unknown, raw: string, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  const text = raw.trim();
  if (text && text.length < 400 && !text.startsWith("<") && !text.startsWith("{")) return text;
  if (status === 401 || status === 403) return "That passcode was not accepted.";
  return `Request failed (${status}).`;
}

export function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
