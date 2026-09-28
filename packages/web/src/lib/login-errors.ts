import { BotanicalApiError } from "@botanical/core";

/** Map login failures to short operator-facing copy. */
export function loginErrorText(error: unknown): string {
  if (error instanceof BotanicalApiError) {
    if (error.status === 401) return "That email or password was not accepted.";
    if (error.status === 403) return error.message || "Signup is not open.";
    if (error.status === 409) return error.message || "An account with that email already exists.";
    if (error.status === 429) return "Too many login attempts. Try again later.";
    if (error.status === 400) return error.message || "Check the form and try again.";
    if (error.status >= 500) return "The server could not sign you in. Try again.";
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

export function passwordClientError(password: string, signup: boolean): string | null {
  if (!password) return "Enter your password.";
  if (signup && password.length < 8) return "Password must be at least 8 characters.";
  return null;
}
