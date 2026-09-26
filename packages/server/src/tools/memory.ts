import { contributorFromBuiltins, type ToolContributor } from "@botanical/agent-runtime";

import type { Store } from "../types.ts";

const OBJECT = { type: "object", additionalProperties: false } as const;

/**
 * Memory tools see shared rows plus the calling agent's own private rows.
 * Another agent's private memory is never readable or deletable here.
 */
export function createMemoryContributor(store: Store): ToolContributor {
  return contributorFromBuiltins(
    [
      {
        name: "memory_write",
        description:
          "Save a memory. scope \"shared\" is visible to every agent (you are recorded as the author). scope \"agent\" is private to you.",
        parameters: {
          ...OBJECT,
          properties: {
            scope: { type: "string", enum: ["shared", "agent"] },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["scope", "content"],
        },
        async execute(args, ctx) {
          const record = asRecord(args);
          const scope = record.scope === "agent" ? "agent" : record.scope === "shared" ? "shared" : null;
          if (!scope) return error("scope must be shared or agent");
          if (typeof record.content !== "string" || record.content.trim() === "") return error("content is required");
          if (record.content.trim().length > 8_000) return error("content is too long");
          const tags = readTags(record.tags);
          if (typeof tags === "string") return error(tags);
          try {
            const memory = await store.memories.create({
              scope,
              agentId: ctx?.agentId ?? null,
              content: record.content,
              tags,
            });
            return { id: memory.id, scope: memory.scope, tags: memory.tags };
          } catch (cause) {
            return error(cause instanceof Error ? cause.message : "memory_write failed");
          }
        },
      },
      {
        name: "memory_search",
        description: "Search memories you can see: shared memories and your own private memories.",
        parameters: {
          ...OBJECT,
          properties: {
            query: { type: "string" },
            scope: { type: "string", enum: ["shared", "agent"] },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["query"],
        },
        async execute(args, ctx) {
          const record = asRecord(args);
          if (typeof record.query !== "string" || record.query.trim() === "") return error("query is required");
          const agentId = ctx?.agentId ?? "";
          const visible = await store.memories.listVisible(agentId, { limit: 200 });
          const tags = readTags(record.tags);
          if (typeof tags === "string") return error(tags);
          const scope = record.scope === "shared" || record.scope === "agent" ? record.scope : undefined;
          const query = record.query.trim().toLowerCase();
          const limit = clamp(record.limit, 8);
          const matches = visible.filter((memory) => {
            if (scope && memory.scope !== scope) return false;
            if (tags.length > 0 && !tags.every((tag) => memory.tags.includes(tag))) return false;
            const haystack = `${memory.content} ${memory.tags.join(" ")}`.toLowerCase();
            return haystack.includes(query);
          });
          return { memories: matches.slice(0, limit).map(brief) };
        },
      },
      {
        name: "memory_list",
        description: "List recent memories you can see (shared, plus your private memories).",
        parameters: {
          ...OBJECT,
          properties: {
            scope: { type: "string", enum: ["shared", "agent"] },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
        async execute(args, ctx) {
          const record = asRecord(args);
          const scope = record.scope === "shared" || record.scope === "agent" ? record.scope : undefined;
          const visible = await store.memories.listVisible(ctx?.agentId ?? "", { limit: 200 });
          const filtered = scope ? visible.filter((memory) => memory.scope === scope) : visible;
          return { memories: filtered.slice(0, clamp(record.limit, 20)).map(brief) };
        },
      },
      {
        name: "memory_delete",
        description: "Delete a shared memory or one of your private memories. You cannot delete another agent's private memory.",
        parameters: {
          ...OBJECT,
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        async execute(args, ctx) {
          const record = asRecord(args);
          if (typeof record.id !== "string" || record.id.trim() === "") return error("id is required");
          const result = await store.memories.deleteVisible(record.id.trim(), ctx?.agentId ?? "");
          if (result === "missing") return error("memory not found");
          if (result === "forbidden") return error("permission denied: that memory belongs to another agent");
          return { deleted: true, id: record.id.trim() };
        },
      },
    ],
    { id: "builtin.memory" },
  );
}

function brief(memory: { id: string; scope: string; agentId: string | null; content: string; tags: string[]; updatedAt: string }) {
  return {
    id: memory.id,
    scope: memory.scope,
    agentId: memory.agentId,
    content: memory.content,
    tags: memory.tags,
    updatedAt: memory.updatedAt,
  };
}

function readTags(value: unknown): string[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "tags must be an array of strings";
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return "tags must be an array of strings";
    tags.push(item.trim());
  }
  return tags;
}

function clamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function error(message: string): { output: { error: string }; isError: true } {
  return { output: { error: message }, isError: true };
}
