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

export function isProfileUnavailable(error: unknown): boolean {
  if (errorCode(error) === "profile_unavailable") return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /profile_unavailable/i.test(message);
}

export function profileUnavailableText(profileName: string, detail: string): string {
  const reason = detail.replace(/^profile_unavailable[:\s]*/i, "").trim() || "it cannot be used right now";
  const name = profileName.trim() || "This profile";
  return `${name} is unavailable: ${reason}. Pick another profile.`;
}

export function roleDeleteText(error: unknown): string | null {
  const code = errorCode(error);
  if (code === "builtin_role") return "Built-in roles can't be deleted.";
  if (code === "role_in_use") return "That role is still assigned to an agent. Unassign it first.";
  return null;
}
