import type { ChatEvent, ChatRequest, LLMProvider, ModelCapabilities } from "./provider";

const CAPABILITIES: ModelCapabilities = {
  tools: true,
  parallelTools: true,
  vision: false,
  maxContext: 16_000,
  streaming: true,
};

/**
 * Deterministic provider for tests and for wiring a vertical slice
 * before packages/providers is merged. Each call consumes one script step.
 */
export function createScriptedProvider(
  script: Array<(req: ChatRequest) => ChatEvent[]>,
): LLMProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    id: "scripted",
    requests,
    capabilities() {
      return CAPABILITIES;
    },
    async *complete(req) {
      requests.push(req);
      const step = script[index];
      index += 1;
      if (!step) {
        yield { type: "done" };
        return;
      }
      for (const event of step(req)) yield event;
    },
  };
}
