import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { authed, type Router } from "../router.ts";
import { sseResponse, textDeltas } from "../streaming.ts";
import type { Chat, Message, ModelProfile } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(router: Router): void {
  router.add(
    "GET",
    "/api/chats/:id/messages",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const messages = await ctx.store.messages.listByChat(chat.id);
      return json(200, { messages });
    }),
  );

  router.add(
    "POST",
    "/api/chats/:id/messages",
    authed(async (ctx) => {
      let chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const content = readBoundedString(body.content, "content", {
        required: true,
        max: LIMITS.content,
      });
      if (!content) throw new HttpError(400, "invalid_body", "content is required");
      const stream = wantsStream(ctx.request, body);

      const profile = resolveProfile(
        ctx.config,
        readRequestedProfileId(body.profileId, false),
        chat.profileId,
      );
      if (profile.id !== chat.profileId) {
        const updated = await ctx.store.chats.update(chat.id, { profileId: profile.id });
        if (!updated) throw new HttpError(404, "not_found", "Chat not found");
        chat = updated;
      }

      const userMessage = await ctx.store.messages.create({
        chatId: chat.id,
        role: "user",
        content,
      });
      // TODO(packages/providers): replace this stub with provider streaming.
      // The selected profile is explicit; do not fall back to a default model.
      const assistantText = stubAssistantText(profile);
      const assistantMessage = await ctx.store.messages.create({
        chatId: chat.id,
        role: "assistant",
        content: assistantText,
      });

      const title = chat.title === "New chat" ? titleFromContent(content) : undefined;
      await ctx.store.chats.update(chat.id, title ? { title } : {});

      if (!stream) {
        return json(201, {
          userMessage,
          assistantMessage,
          profileId: profile.id,
        });
      }
      return sseResponse(streamEvents(userMessage, assistantMessage, assistantText));
    }),
  );
}

async function loadChat(store: { chats: { get(id: string): Promise<Chat | null> } }, id: string): Promise<Chat> {
  const chat = await store.chats.get(id);
  if (!chat) throw new HttpError(404, "not_found", "Chat not found");
  return chat;
}

function wantsStream(request: Request, body: Record<string, unknown>): boolean {
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new HttpError(400, "invalid_body", "stream must be a boolean");
  }
  if (typeof body.stream === "boolean") return body.stream;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

function stubAssistantText(profile: ModelProfile): string {
  return `Stub reply. Model streaming is not wired yet. Profile ${profile.id} (${profile.provider}/${profile.model}) was selected explicitly.`;
}

function titleFromContent(content: string): string {
  const oneLine = content.trim().replace(/\s+/g, " ");
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 77)}...`;
}

function streamEvents(userMessage: Message, assistantMessage: Message, assistantText: string) {
  return [
    { event: "message.created", data: { message: userMessage } },
    ...textDeltas(assistantText).map((text) => ({ event: "text-delta", data: { text } })),
    { event: "message.completed", data: { message: assistantMessage } },
    { event: "done", data: {} },
  ];
}
