import { HttpError, json, noContent, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { MemoryRecord, MemoryScope, Store } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMemories(router: Router): void {
  router.add(
    "GET",
    "/api/memories",
    authed(async (ctx) => {
      const memories = await ctx.store.memories.list(readMemoryQuery(ctx.url));
      return json(200, { memories: memories.map(presentMemory) });
    }),
  );

  router.add(
    "POST",
    "/api/memories",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const memory = await ctx.store.memories.create(await parseNewMemory(ctx.store, body));
      return json(201, { memory: presentMemory(memory) });
    }),
  );

  router.add(
    "GET",
    "/api/memories/:id",
    authed(async (ctx) => {
      const memory = await ctx.store.memories.get(requireParam(ctx.params, "id"));
      if (!memory) throw new HttpError(404, "not_found", "Memory not found");
      return json(200, { memory: presentMemory(memory) });
    }),
  );

  router.add(
    "PATCH",
    "/api/memories/:id",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const memory = await ctx.store.memories.update(requireParam(ctx.params, "id"), parseMemoryPatch(body));
      if (!memory) throw new HttpError(404, "not_found", "Memory not found");
      return json(200, { memory: presentMemory(memory) });
    }),
  );

  router.add(
    "DELETE",
    "/api/memories/:id",
    authed(async (ctx) => {
      const removed = await ctx.store.memories.delete(requireParam(ctx.params, "id"));
      if (!removed) throw new HttpError(404, "not_found", "Memory not found");
      return noContent();
    }),
  );
}

function presentMemory(memory: MemoryRecord) {
  return {
    id: memory.id,
    scope: memory.scope,
    agentId: memory.agentId,
    content: memory.content,
    tags: [...memory.tags],
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export async function parseNewMemory(store: Store, body: unknown): Promise<{
  scope: MemoryScope;
  agentId: string | null;
  content: string;
  tags: string[];
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "JSON object expected");
  }
  const record = body as Record<string, unknown>;
  const scope = readScope(record.scope);
  const content = readBoundedString(record.content, "content", { required: true, max: LIMITS.memory });
  if (!content) throw new HttpError(400, "invalid_body", "content is required");
  const agentId = await readMemoryAgent(store, record.agentId, scope);
  return { scope, agentId, content, tags: readTags(record.tags) };
}

function parseMemoryPatch(body: unknown): { content?: string; tags?: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "JSON object expected");
  }
  const record = body as Record<string, unknown>;
  const patch: { content?: string; tags?: string[] } = {};
  if (Object.prototype.hasOwnProperty.call(record, "content")) {
    const content = readBoundedString(record.content, "content", { required: true, max: LIMITS.memory });
    if (!content) throw new HttpError(400, "invalid_body", "content is required");
    patch.content = content;
  }
  if (Object.prototype.hasOwnProperty.call(record, "tags")) patch.tags = readTags(record.tags);
  if (patch.content === undefined && patch.tags === undefined) {
    throw new HttpError(400, "invalid_body", "No fields to update");
  }
  return patch;
}

function readMemoryQuery(url: URL): MemoryQuerySafe {
  const scopeRaw = url.searchParams.get("scope");
  const scope = scopeRaw ? readScope(scopeRaw) : undefined;
  const agentId = url.searchParams.get("agentId")?.trim() || undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const tag = url.searchParams.get("tag")?.trim() || undefined;
  const limitRaw = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitRaw) {
    if (!/^\d+$/.test(limitRaw)) throw new HttpError(400, "invalid_query", "limit must be an integer");
    limit = Number(limitRaw);
    if (limit < 1 || limit > 200) throw new HttpError(400, "invalid_query", "limit must be from 1 to 200");
  }
  return {
    ...(scope ? { scope } : {}),
    ...(agentId ? { agentId } : {}),
    ...(q ? { q } : {}),
    ...(tag ? { tag } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

interface MemoryQuerySafe {
  scope?: MemoryScope;
  agentId?: string;
  q?: string;
  tag?: string;
  limit?: number;
}

function readScope(value: unknown): MemoryScope {
  if (value !== "shared" && value !== "agent") {
    throw new HttpError(400, "invalid_body", "scope must be shared or agent");
  }
  return value;
}

async function readMemoryAgent(store: Store, value: unknown, scope: MemoryScope): Promise<string | null> {
  if (value === undefined || value === null || value === "") {
    if (scope === "agent") throw new HttpError(400, "invalid_body", "agent scope requires agentId");
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_body", "agentId must be a string");
  }
  const agent = await store.agents.get(value.trim());
  if (!agent) throw new HttpError(400, "invalid_body", "agentId does not match an agent");
  return agent.id;
}

export function readTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "invalid_body", "tags must be an array of strings");
  if (value.length > 20) throw new HttpError(400, "invalid_body", "tags cannot exceed 20 entries");
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new HttpError(400, "invalid_body", "tags must be an array of strings");
    const tag = item.trim();
    if (!tag || tag.length > 40) throw new HttpError(400, "invalid_body", "each tag must be 1-40 characters");
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
