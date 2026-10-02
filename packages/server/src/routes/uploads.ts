import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toolAllowed } from "@botanical/agent-runtime";
import {
  ATTACHMENT_DIR,
  ATTACHMENT_MAX_BYTES,
  isImageType,
  safeAttachmentName,
  safeMimeType,
  type AttachmentRef,
} from "@botanical/core";

import { HttpError, json } from "../http.ts";
import { authed, type Router } from "../router.ts";
import { agentWorkspace } from "../runtime/workspace.ts";
import { requireParam } from "../validate.ts";

/**
 * Chat attachments. A file is saved in the agent's own workspace under `uploads/`
 * (the same directory the Files tab lists) and the message then names it. Files
 * the model cannot read as an image need the agent's `file_read` tool.
 */
export function registerUploads(router: Router): void {
  router.add(
    "POST",
    "/api/agents/:id/uploads",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      const name = safeAttachmentName(ctx.url.searchParams.get("name") ?? "");
      const mimeType = safeMimeType(ctx.request.headers.get("content-type"));
      if (!isImageType(mimeType) && !toolAllowed(agent.toolIds, "file_read")) {
        throw new HttpError(403, "not_allowed", `${agent.name} cannot read files, so only images can be attached.`);
      }
      const declared = ctx.request.headers.get("content-length");
      if (declared !== null && Number(declared) > ATTACHMENT_MAX_BYTES) throw tooLarge();
      const bytes = new Uint8Array(await ctx.request.arrayBuffer());
      if (bytes.byteLength === 0) throw new HttpError(400, "invalid_body", "The file is empty");
      if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw tooLarge();

      const dir = join(agentWorkspace(agent.id), ATTACHMENT_DIR);
      mkdirSync(dir, { recursive: true });
      const stored = `${randomUUID().slice(0, 8)}-${name.replace(/ /g, "_")}`;
      await writeFile(join(dir, stored), bytes);
      const file: AttachmentRef = { path: `${ATTACHMENT_DIR}/${stored}`, name, mimeType, size: bytes.byteLength };
      return json(201, { file });
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id/uploads/:file",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      const stored = requireParam(ctx.params, "file");
      if (!/^[A-Za-z0-9._-]+$/.test(stored) || stored.startsWith(".")) {
        throw new HttpError(400, "invalid_query", "Invalid file name");
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(join(agentWorkspace(agent.id), ATTACHMENT_DIR, stored));
      } catch {
        throw new HttpError(404, "not_found", "File not found");
      }
      const mimeType = mimeFromName(stored);
      const headers: Record<string, string> = {
        "content-type": mimeType,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      };
      // Only raster images render inline. Anything else downloads, so an upload never runs as a page.
      if (!isImageType(mimeType)) headers["content-disposition"] = "attachment";
      return new Response(new Uint8Array(bytes), { status: 200, headers });
    }),
  );
}

function tooLarge(): HttpError {
  return new HttpError(413, "payload_too_large", `Files can be at most ${ATTACHMENT_MAX_BYTES / 1_000_000} MB`);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Served type comes from the stored extension, never from what the uploader claimed. */
export function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS[ext] ?? "application/octet-stream";
}
