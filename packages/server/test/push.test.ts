import { describe, expect, test } from "bun:test";

import { createPushService, withPush, type PushSender } from "../src/push/service.ts";
import { createMemoryStore } from "../src/db/memory.ts";

function setup() {
  const store = createMemoryStore({ encryptionKey: "test-encryption-key" });
  const sent: Array<{ endpoint: string; payload: string }> = [];
  const sender: PushSender = {
    async sendNotification(subscription, payload) {
      if (subscription.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: subscription.endpoint, payload });
    },
  };
  const push = createPushService({ store, sender });
  return { store, push, sent };
}

const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

describe("push service", () => {
  test("generates a stable VAPID key", async () => {
    const { push } = setup();
    const first = await push.publicKey();
    expect(first).toBeTruthy();
    expect(await push.publicKey()).toBe(first);
  });

  test("delivers to subscribed devices, honours toggles, drops dead endpoints", async () => {
    const { store, push, sent } = setup();
    const wrapped = withPush(store, push);
    const owner = (await wrapped.notifications.create({ kind: "run_succeeded", title: "Prime", body: "" })).userId;
    await push.subscribe(owner, sub("https://push.example/ok"), new Date());
    await push.subscribe(owner, sub("https://push.example/gone"), new Date());

    await wrapped.notifications.create({ kind: "attention", title: "Look", body: "Now" });
    await Bun.sleep(20);
    expect(sent.map((item) => item.endpoint)).toEqual(["https://push.example/ok"]);
    expect(JSON.parse(sent[0]!.payload).title).toBe("Look");
    expect((await push.listSubscriptions(owner)).map((item) => item.endpoint)).toEqual([
      "https://push.example/ok",
    ]);

    await push.setEvents(owner, { attention: false });
    await wrapped.notifications.create({ kind: "attention", title: "Muted", body: "" });
    await Bun.sleep(20);
    expect(sent).toHaveLength(1);
  });
});
