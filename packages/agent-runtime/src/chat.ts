import { z } from "zod";
import { idSchema } from "./agent";

/** A chat is created already bound to one agent. The binding is not updatable. */
export const createChatSchema = z
  .object({
    id: idSchema.optional(),
    agentId: idSchema,
    title: z.string().trim().max(200).optional(),
  })
  .strict();

export const updateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export type CreateChatInput = z.infer<typeof createChatSchema>;
export type UpdateChatInput = z.infer<typeof updateChatSchema>;

export interface ChatRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
