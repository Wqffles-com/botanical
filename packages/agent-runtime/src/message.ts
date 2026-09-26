import { z } from "zod";
import { idSchema } from "./agent";

export const postMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(100_000),
    /** Required on every turn. The server never fills this in. */
    profileId: z.string().trim().min(1).max(120),
    /** Optional echo of the owning agent. A different id is rejected. */
    agentId: idSchema.optional(),
  })
  .strict();

export type PostMessageInput = z.infer<typeof postMessageSchema>;

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  /** Profile used for this turn. Set on user, assistant, and tool rows. */
  profileId?: string;
  createdAt: string;
}

export interface NewMessage {
  id?: string;
  chatId: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  profileId?: string;
}
