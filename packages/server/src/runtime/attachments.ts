import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageContent } from "@botanical/agent-runtime";
import { ATTACHMENT_DIR, ATTACHMENT_MAX_BYTES, isImageType, splitAttachments } from "@botanical/core";
import { mimeFromName } from "../routes/uploads.ts";
import { agentWorkspace } from "./workspace.ts";

/** Images a user message attaches, read from the agent's `uploads/` directory. Missing files are skipped. */
export async function loadAttachedImages(agentId: string, content: string): Promise<ImageContent[]> {
  const { files } = splitAttachments(content);
  const images: ImageContent[] = [];
  for (const file of files) {
    const stored = file.path.slice(ATTACHMENT_DIR.length + 1);
    const mimeType = mimeFromName(stored);
    if (!isImageType(mimeType) || stored.includes("/") || stored.startsWith(".")) continue;
    try {
      const bytes = await readFile(join(agentWorkspace(agentId), ATTACHMENT_DIR, stored));
      if (bytes.byteLength > ATTACHMENT_MAX_BYTES) continue;
      images.push({ mimeType, data: bytes.toString("base64") });
    } catch {
      // A deleted upload leaves the text reference and no picture.
    }
  }
  return images;
}
