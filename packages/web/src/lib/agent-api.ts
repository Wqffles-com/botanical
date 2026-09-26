import { api } from "@/lib/api";
import {
  agentWritePayload,
  identityFromUnknown,
  toolsFromUnknown,
  type AgentDraft,
  type AgentIdentity,
  type ProfileInfo,
  type ToolInfo,
} from "./agent-identity";

export class AgentApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
  }
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });
  if (response.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new AgentApiError("Sign in to continue.", 401);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new AgentApiError(errorMessage(body, response.status), response.status);
  }
  return body;
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
        return (value as { message: string }).message;
      }
    }
  }
  if (status === 404) return "Agent not found.";
  if (status === 409) return "This agent still owns chats. Delete those chats first.";
  return "The server could not save that agent.";
}

export async function listAgents(): Promise<AgentIdentity[]> {
  const agents = await api.listAgents();
  return agents.map((agent) => identityFromUnknown(agent));
}

export async function getAgent(id: string): Promise<AgentIdentity> {
  const agents = await api.listAgents();
  const found = agents.find((agent) => agent.id === id);
  if (!found) throw new AgentApiError("Agent not found.", 404);
  return identityFromUnknown(found);
}

export async function createAgent(draft: AgentDraft): Promise<AgentIdentity> {
  const payload = agentWritePayload(draft);
  const created = await api.createAgent({
    name: payload.name,
    description: payload.description,
    prompt: payload.prompt,
    icon: payload.icon,
    color: payload.color,
    tools: payload.tools,
    defaultProfileId: payload.defaultProfileId,
  });
  return identityFromUnknown(created);
}

export async function updateAgent(id: string, draft: AgentDraft): Promise<AgentIdentity> {
  const payload = agentWritePayload(draft);
  const saved = await api.updateAgent(id, {
    name: payload.name,
    description: payload.description,
    prompt: payload.prompt,
    icon: payload.icon,
    color: payload.color,
    tools: payload.tools,
    defaultProfileId: payload.defaultProfileId,
  });
  return identityFromUnknown(saved);
}

export async function deleteAgent(id: string): Promise<void> {
  await api.deleteAgent(id);
}

export async function listTools(): Promise<ToolInfo[]> {
  try {
    const body = await requestJson("/api/tools");
    return toolsFromUnknown(body);
  } catch (error) {
    if (error instanceof AgentApiError && error.status === 404) return [];
    throw error;
  }
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const profiles = await api.listProfiles();
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    description: profile.description ?? "",
  }));
}
