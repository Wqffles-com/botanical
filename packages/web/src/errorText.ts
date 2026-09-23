import { AgentRequiredError, BotanicalApiError, ProfileRequiredError } from "@botanical/core";

export function errorText(error: unknown): string {
  if (
    error instanceof ProfileRequiredError ||
    error instanceof AgentRequiredError ||
    error instanceof BotanicalApiError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    if (error.name === "TypeError" || /failed to fetch|networkerror|econnrefused|fetch failed/i.test(error.message)) {
      return "Botanical server is unreachable.";
    }
    return error.message || "Something went wrong.";
  }
  return "Something went wrong.";
}
