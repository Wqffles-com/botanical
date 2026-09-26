import { describe, expect, test } from "bun:test";
import { BotanicalClient } from "./client";

describe("agent message client", () => {
  test("lists, sends, and updates agent messages", async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const text = request.method === "GET" ? "" : await request.text();
        calls.push({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          body: text ? (JSON.parse(text) as unknown) : null,
        });
        if (request.method === "GET") {
          return Response.json({
            messages: [
              {
                id: "m1",
                from_agent_id: "a",
                to_agent_id: "b",
                body: "Hello",
                status: "delivered",
                created_at: "2026-09-24T00:00:00.000Z",
              },
            ],
          });
        }
        if (request.method === "POST") {
          return Response.json(
            {
              message: {
                id: "m2",
                fromAgentId: "a",
                toAgentId: "b",
                body: "Hello",
                status: "delivered",
                createdAt: "2026-09-24T00:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        return Response.json({
          message: {
            id: "m2",
            fromAgentId: "a",
            toAgentId: "b",
            body: "Hello",
            status: "read",
            createdAt: "2026-09-24T00:00:00.000Z",
          },
        });
      },
    });

    try {
      const client = new BotanicalClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        getToken: () => "token",
      });
      const listed = await client.listAgentMessages("agent b");
      expect(listed[0]).toMatchObject({
        id: "m1",
        fromAgentId: "a",
        toAgentId: "b",
        body: "Hello",
        status: "delivered",
      });
      const sent = await client.sendAgentMessage({ fromAgentId: "a", toAgentId: "b", body: " Hello " });
      expect(sent.id).toBe("m2");
      const updated = await client.updateAgentMessage("m2", { status: "read" });
      expect(updated.status).toBe("read");
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "GET /api/agent-messages?agentId=agent%20b",
        "POST /api/agent-messages",
        "PATCH /api/agent-messages/m2",
      ]);
      expect(calls[1]?.body).toEqual({ fromAgentId: "a", toAgentId: "b", body: "Hello" });
      expect(calls[2]?.body).toEqual({ status: "read" });
    } finally {
      server.stop(true);
    }
  });
});
