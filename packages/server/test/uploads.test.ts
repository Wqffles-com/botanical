import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ATTACHMENT_MAX_BYTES, withAttachments, type AttachmentRef } from "@botanical/core";
import { runAsUser } from "@botanical/db";
import { loadAttachedImages } from "../src/runtime/attachments.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

let root = "";
let previous: string | undefined;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "botanical-uploads-"));
  previous = process.env.BOTANICAL_WORKSPACE;
  process.env.BOTANICAL_WORKSPACE = root;
});

afterAll(() => {
  if (previous === undefined) delete process.env.BOTANICAL_WORKSPACE;
  else process.env.BOTANICAL_WORKSPACE = previous;
  rmSync(root, { recursive: true, force: true });
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("chat attachments", () => {
  test("saves an image, lists it in the workspace, and serves it back inline", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const up = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}/uploads?name=${encodeURIComponent("../cat pic.png")}`, {
        method: "POST",
        headers: { "content-type": "image/png", ...bearer(token) },
        body: PNG,
      }),
    );
    expect(up.status).toBe(201);
    const { file } = await readJson<{ file: AttachmentRef }>(up);
    expect(file).toMatchObject({ name: "cat pic.png", mimeType: "image/png", size: PNG.byteLength });
    expect(file.path).toMatch(/^uploads\/[0-9a-f]{8}-cat_pic\.png$/);

    const listing = await readJson<{ entries: Array<{ path: string }> }>(
      await app.fetch(new Request(`http://localhost/api/agents/${agent.id}/files?path=uploads`, { headers: bearer(token) })),
    );
    expect(listing.entries.map((entry) => entry.path)).toEqual([file.path]);

    const served = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}/uploads/${file.path.split("/")[1]}`, { headers: bearer(token) }),
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  test("other files need the agent's file tool and download rather than render", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const blocked = await createAgent(app, token, { toolIds: ["web.search"] });
    const open = await createAgent(app, token, { name: "Reader", toolIds: ["file_read"] });
    const upload = (id: string) =>
      app.fetch(
        new Request(`http://localhost/api/agents/${id}/uploads?name=a.html`, {
          method: "POST",
          headers: { "content-type": "text/html", ...bearer(token) },
          body: "<script>1</script>",
        }),
      );
    expect((await upload(blocked.id)).status).toBe(403);
    const ok = await upload(open.id);
    expect(ok.status).toBe(201);
    const { file } = await readJson<{ file: AttachmentRef }>(ok);
    const served = await app.fetch(
      new Request(`http://localhost/api/agents/${open.id}/uploads/${file.path.split("/")[1]}`, { headers: bearer(token) }),
    );
    expect(served.headers.get("content-type")).toBe("application/octet-stream");
    expect(served.headers.get("content-disposition")).toBe("attachment");
  });

  test("rejects empty and oversized files, and path tricks on download", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token, { toolIds: ["file_read"] });
    const post = (body: Uint8Array) =>
      app.fetch(
        new Request(`http://localhost/api/agents/${agent.id}/uploads?name=x.bin`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", ...bearer(token) },
          body: body as BodyInit,
        }),
      );
    expect((await post(new Uint8Array())).status).toBe(400);
    expect((await post(new Uint8Array(ATTACHMENT_MAX_BYTES + 1))).status).toBe(413);
    const trick = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}/uploads/..%2Fsecret`, { headers: bearer(token) }),
    );
    expect([400, 404]).toContain(trick.status);
  });

  test("the model reads attached images from the agent's uploads", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const up = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}/uploads?name=a.png`, {
        method: "POST",
        headers: { "content-type": "image/png", ...bearer(token) },
        body: PNG,
      }),
    );
    const { file } = await readJson<{ file: AttachmentRef }>(up);
    const content = withAttachments("what is this?", [file]);
    const me = await readJson<{ user: { id: string } }>(
      await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) })),
    );
    // Turns run scoped to the chat's user, which is where the upload went.
    const images = await runAsUser(me.user.id, () => loadAttachedImages(agent.id, content));
    expect(images).toEqual([{ mimeType: "image/png", data: Buffer.from(PNG).toString("base64") }]);
    expect(await runAsUser(me.user.id, () => loadAttachedImages(agent.id, "no files"))).toEqual([]);
  });
});
