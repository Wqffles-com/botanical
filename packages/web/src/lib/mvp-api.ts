import {
  BotanicalApiError,
  isUnauthorized,
  type Health,
  type ModelProfile,
} from "@botanical/core";
import { api } from "@/lib/api";
import {
  missingEndpoint,
  parseAgentMessage,
  parseAgentMessages,
  parseMcpSnapshot,
  parseSettings,
  parseToolList,
} from "./parse";
import type { AgentMessage, AgentMessageStatus, AppSettings, CatalogTool, McpSnapshot } from "./mvp-types";

export { isUnauthorized, api };

export async function fetchHealth(): Promise<Health | null> {
  try {
    return await api.health();
  } catch {
    return null;
  }
}

export async function fetchProfiles(): Promise<ModelProfile[]> {
  return api.listProfiles();
}

export async function fetchTools(): Promise<CatalogTool[]> {
  try {
    const body = await requestJson("/api/tools");
    return parseToolList(body);
  } catch (error) {
    if (missingEndpoint(error)) return [];
    throw error;
  }
}

export async function fetchMcpServers(): Promise<McpSnapshot> {
  try {
    const body = await requestJson("/api/mcp/servers");
    return parseMcpSnapshot(body);
  } catch (error) {
    if (missingEndpoint(error)) return { disabled: false, source: "empty", configError: null, servers: [] };
    throw error;
  }
}

export async function fetchSettings(): Promise<AppSettings> {
  const health = await fetchHealth();
  try {
    const body = await requestJson("/api/settings");
    return parseSettings(body, {
      deploymentMode: health?.mode ?? null,
      brandName: health?.brandName ?? null,
      version: health?.version ?? null,
    });
  } catch (error) {
    if (missingEndpoint(error)) {
      return parseSettings(
        {},
        {
          deploymentMode: health?.mode ?? null,
          brandName: health?.brandName ?? null,
          version: health?.version ?? null,
        },
      );
    }
    throw error;
  }
}

export async function fetchAgentMessages(agentId?: string, agentIds: string[] = []): Promise<AgentMessage[]> {
  if (agentId && agentId !== "all") return listForAgent(agentId);
  if (agentIds.length > 0) {
    const lists = await Promise.all(agentIds.map((id) => listForAgent(id)));
    const byId = new Map<string, AgentMessage>();
    for (const message of lists.flat()) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  try {
    const body = await requestJson("/api/agent-messages");
    return parseAgentMessages(body);
  } catch (error) {
    if (missingEndpoint(error) || (error instanceof BotanicalApiError && error.status === 400)) return [];
    throw error;
  }
}

async function listForAgent(agentId: string): Promise<AgentMessage[]> {
  try {
    const listed = a2aClient()?.listAgentMessages;
    if (listed) return (await listed.call(api, agentId)).map(asAgentMessage);
    const body = await requestJson(`/api/agent-messages?agentId=${encodeURIComponent(agentId)}`);
    return parseAgentMessages(body);
  } catch (error) {
    if (missingEndpoint(error)) return [];
    throw error;
  }
}

export async function sendAgentMessage(input: {
  fromAgentId: string;
  toAgentId: string;
  body: string;
}): Promise<AgentMessage> {
  const send = a2aClient()?.sendAgentMessage;
  if (send) return asAgentMessage(await send.call(api, input));
  const body = await requestJson("/api/agent-messages", {
    method: "POST",
    body: JSON.stringify({
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      body: input.body,
    }),
  });
  return parseAgentMessage(body);
}

export async function patchAgentMessageStatus(
  id: string,
  status: AgentMessageStatus,
  current?: AgentMessageStatus,
): Promise<AgentMessage> {
  try {
    return await patchStatus(id, status);
  } catch (error) {
    if (status === "read" && current === "pending") {
      await patchStatus(id, "delivered");
      return patchStatus(id, "read");
    }
    throw error;
  }
}

async function patchStatus(id: string, status: AgentMessageStatus): Promise<AgentMessage> {
  const update = a2aClient()?.updateAgentMessage;
  if (update) return asAgentMessage(await update.call(api, id, { status }));
  const body = await requestJson(`/api/agent-messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return parseAgentMessage(body);
}

type A2AClient = {
  listAgentMessages: (agentId: string) => Promise<Array<Record<string, unknown> | AgentMessage>>;
  sendAgentMessage: (input: {
    fromAgentId: string;
    toAgentId: string;
    body: string;
  }) => Promise<Record<string, unknown> | AgentMessage>;
  updateAgentMessage: (
    id: string,
    input: { status: AgentMessageStatus },
  ) => Promise<Record<string, unknown> | AgentMessage>;
};

function a2aClient(): A2AClient | null {
  const client = api as unknown as Partial<A2AClient>;
  if (typeof client.listAgentMessages === "function" && typeof client.sendAgentMessage === "function") {
    return client as A2AClient;
  }
  return null;
}

function asAgentMessage(value: AgentMessage | Record<string, unknown>): AgentMessage {
  if (value && typeof value === "object" && "fromAgentId" in value && "body" in value && "status" in value) {
    const message = value as AgentMessage;
    if (typeof message.id === "string") return message;
  }
  return parseAgentMessage(value);
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", headers.get("accept") ?? "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
  if (response.status === 204) return null;
  const raw = await response.text();
  const body = raw ? parseJson(raw) : null;
  if (!response.ok) {
    throw new BotanicalApiError(readErrorMessage(body, raw, response.status), {
      status: response.status,
      body,
    });
  }
  return body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readErrorMessage(body: unknown, raw: string, status: number): string {
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
