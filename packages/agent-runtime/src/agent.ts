import { z } from "zod";
import { ID_RE } from "./ids";

export const idSchema = z.string().regex(ID_RE, "id must be 1–80 chars of letters, digits, _ or -");

/**
 * User-defined agent. `prompt` is the system prompt. `toolAllowlist` gates
 * built-ins and MCP tools. Empty allowlist means no external tools.
 * Runtime A2A tools are controlled by `a2aEnabled`, not the allowlist.
 */
export const createAgentSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).default(""),
    prompt: z.string().trim().min(1).max(100_000),
    toolAllowlist: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
    a2aEnabled: z.boolean().default(true),
  })
  .strict();

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(4000).optional(),
    prompt: z.string().trim().min(1).max(100_000).optional(),
    toolAllowlist: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    a2aEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "no fields to update" });

/** File-loaded agents must carry a stable id so restarts upsert instead of duplicating. */
export const agentConfigSchema = createAgentSchema.extend({
  id: idSchema,
});

export const agentConfigFileSchema = z.array(agentConfigSchema).max(500);

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  prompt: string;
  toolAllowlist: string[];
  a2aEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
