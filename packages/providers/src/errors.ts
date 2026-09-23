export type ProviderErrorCode =
  | "profile_required"
  | "unknown_profile"
  | "unknown_provider"
  | "missing_api_key"
  | "config"
  | "http"
  | "network"
  | "stream"
  | "timeout"
  | "aborted";

export interface ProviderErrorOptions {
  providerId?: string;
  status?: number;
  code?: ProviderErrorCode;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly providerId: string | undefined;
  readonly status: number | undefined;
  readonly code: ProviderErrorCode;

  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.providerId = options.providerId;
    this.status = options.status;
    this.code = options.code ?? "stream";
  }
}

export class ProfileRequiredError extends ProviderError {
  constructor() {
    super("profileId is required. Botanical has no default model profile.", {
      code: "profile_required",
    });
    this.name = "ProfileRequiredError";
  }
}

export class UnknownProfileError extends ProviderError {
  constructor(profileId: string) {
    super(`Unknown model profile "${profileId}".`, { code: "unknown_profile" });
    this.name = "UnknownProfileError";
  }
}

export class UnknownProviderError extends ProviderError {
  constructor(providerId: string) {
    super(`Unknown provider "${providerId}".`, {
      providerId,
      code: "unknown_provider",
    });
    this.name = "UnknownProviderError";
  }
}

export class MissingApiKeyError extends ProviderError {
  readonly envName: string;

  constructor(envName: string, providerId?: string) {
    super(
      providerId
        ? `Missing API key for provider "${providerId}". Set server environment variable ${envName}.`
        : `Missing API key. Set server environment variable ${envName}.`,
      { providerId, code: "missing_api_key" },
    );
    this.name = "MissingApiKeyError";
    this.envName = envName;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

export function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown provider error");
}
