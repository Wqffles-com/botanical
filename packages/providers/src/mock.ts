import { capabilitiesFor } from "./capabilities.ts";
import type { ChatEvent, ChatRequest, LLMProvider, MockScript, ModelCapabilities } from "./types.ts";

export interface MockProvider extends LLMProvider {
  readonly calls: ChatRequest[];
  reset(): void;
}

/** In-process provider for tests and the server golden path. Never calls the network. */
export function createMockProvider(id = "mock", script: MockScript = {}): MockProvider {
  const calls: ChatRequest[] = [];
  return {
    id,
    type: "mock",
    calls,
    reset() {
      calls.length = 0;
    },
    assertReady() {},
    capabilities(model: string): ModelCapabilities {
      return {
        ...capabilitiesFor("mock", model),
        ...script.capabilities,
      };
    },
    async *complete(request: ChatRequest): AsyncGenerator<ChatEvent> {
      calls.push(snapshotRequest(request));
      if (request.signal?.aborted) {
        throw request.signal.reason instanceof Error
          ? request.signal.reason
          : new DOMException("Aborted", "AbortError");
      }
      const scripted = script.events
        ? typeof script.events === "function"
          ? script.events(request)
          : script.events
        : undefined;
      if (scripted) {
        let terminal = false;
        for (const event of scripted) {
          if (event.type === "done" || event.type === "error") terminal = true;
          yield event;
        }
        if (!terminal) yield { type: "done" };
        return;
      }
      const reply =
        typeof script.reply === "function" ? script.reply(request) : (script.reply ?? echo(request));
      const size = script.chunkSize && script.chunkSize > 0 ? script.chunkSize : 12;
      for (let i = 0; i < reply.length; i += size) {
        yield { type: "text-delta", text: reply.slice(i, i + size) };
      }
      yield { type: "done" };
    },
  };
}

function echo(request: ChatRequest): string {
  const last = [...request.messages].reverse().find((message) => message.role === "user");
  if (!last) return "";
  const text =
    typeof last.content === "string"
      ? last.content
      : last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return `mock:${text}`;
}

function snapshotRequest(request: ChatRequest): ChatRequest {
  const { signal: _signal, ...rest } = request;
  return structuredClone(rest);
}
