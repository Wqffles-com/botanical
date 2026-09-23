import type { LLMProvider } from "@botanical/core";

/**
 * Dev-only brain. It is not selected unless a client passes its profile id.
 * Enable with BOTANICAL_DEV_PROVIDER=echo.
 */
export function createEchoProvider(): LLMProvider {
  return {
    id: "echo",
    capabilities() {
      return {
        tools: false,
        parallelTools: false,
        vision: false,
        maxContext: 8192,
        streaming: true,
      };
    },
    async *complete(req) {
      const lastUser = [...req.messages]
        .reverse()
        .find((message) => message.role === "user" && message.name !== "a2a-inbox");
      const text = typeof lastUser?.content === "string" ? lastUser.content : "";
      const reply = `echo: ${text}`;
      const size = 12;
      for (let i = 0; i < reply.length; i += size) {
        yield { type: "text-delta", text: reply.slice(i, i + size) };
      }
      yield { type: "done" };
    },
  };
}
