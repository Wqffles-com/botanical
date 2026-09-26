import { AgentRequiredError, BotanicalApiError, ProfileRequiredError } from "@botanical/core";

export function errorCode(error: unknown): string | null {
  if (error instanceof ProfileRequiredError) return "profile_required";
  if (error instanceof AgentRequiredError) return "agent_required";
  if (error instanceof BotanicalApiError && error.body && typeof error.body === "object") {
    const nested = (error.body as { error?: unknown }).error;
    if (nested && typeof nested === "object" && typeof (nested as { code?: unknown }).code === "string") {
      return (nested as { code: string }).code;
    }
  }
  return null;
}

export function isProfileRequired(error: unknown): boolean {
  if (error instanceof ProfileRequiredError) return true;
  if (errorCode(error) === "profile_required") return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /profile_required|choose a model profile|no default model/i.test(message);
}

export function errorText(error: unknown): string {
  if (error instanceof ProfileRequiredError) {
    return error.message || "Choose a model profile. Botanical has no default model.";
  }
  if (error instanceof AgentRequiredError) {
    return error.message || "Choose one agent for this chat.";
  }
  if (error instanceof BotanicalApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === "TypeError" || /failed to fetch|networkerror|econnrefused|fetch failed/i.test(error.message)) {
      return "Botanical server is unreachable.";
    }
    return error.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

export function profileRequiredMessage(error?: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Choose a model profile to write. Botanical has no default model.";
}
