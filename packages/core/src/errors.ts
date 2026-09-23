/** Domain errors mapped to HTTP status codes by the server. */
export class BotanicalError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class ProfileRequiredError extends BotanicalError {
  constructor() {
    super(
      "profileId is required — Botanical has no default model profile",
      "PROFILE_REQUIRED",
      400,
    );
  }
}

export class ProfileNotFoundError extends BotanicalError {
  constructor(id: string) {
    super(`Unknown model profile "${id}"`, "PROFILE_NOT_FOUND", 404);
  }
}

export class AgentNotFoundError extends BotanicalError {
  constructor(id: string) {
    super(`Agent not found: ${id}`, "AGENT_NOT_FOUND", 404);
  }
}

export class ChatNotFoundError extends BotanicalError {
  constructor(id: string) {
    super(`Chat not found: ${id}`, "CHAT_NOT_FOUND", 404);
  }
}

export class AgentBindingError extends BotanicalError {
  constructor(message: string) {
    super(message, "AGENT_BINDING", 409);
  }
}

export class AgentInUseError extends BotanicalError {
  constructor(id: string) {
    super(`Agent "${id}" still owns chats and cannot be deleted`, "AGENT_IN_USE", 409);
  }
}

export class ValidationError extends BotanicalError {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION", 400);
    this.details = details;
  }
}
