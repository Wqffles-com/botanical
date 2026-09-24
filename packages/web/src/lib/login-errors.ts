import { BotanicalApiError } from "@botanical/core";

/** Map login failures to short operator-facing copy. */
export function loginErrorText(error: unknown): string {
  if (error instanceof BotanicalApiError) {
    if (error.status === 401 || error.status === 403) return "That passcode was not accepted.";
    if (error.status === 429) return "Too many login attempts. Try again later.";
    if (error.status === 400) return error.message || "Enter the server passcode.";
    if (error.status >= 500) return "The server could not check the passcode. Try again.";
    return error.message || "Could not sign in.";
  }
  if (error instanceof Error) {
    if (error.name === "TypeError" || /failed to fetch|networkerror|econnrefused|fetch failed/i.test(error.message)) {
      return "Botanical server is unreachable.";
    }
    return error.message || "Could not sign in.";
  }
  return "Could not sign in.";
}

export function passcodeClientError(passcode: string): string | null {
  const trimmed = passcode.trim();
  if (!trimmed) return "Enter the server passcode.";
  if (trimmed.length < 4) return "Passcode is too short.";
  return null;
}
