/**
 * Files attached to a chat message. Uploads land in the agent's workspace under
 * `uploads/`. The message text then ends with a block that names them, so the
 * model and its tools can find them and the web app can draw chips and thumbnails
 * without a schema change.
 */

export interface AttachmentRef {
  /** POSIX path relative to the agent's workspace, always under `uploads/`. */
  path: string;
  /** The file name as the user saw it. */
  name: string;
  mimeType: string;
  size: number;
}

export const ATTACHMENT_DIR = "uploads";
/** Largest single file the upload route takes. Stays under the web proxy's body cap. */
export const ATTACHMENT_MAX_BYTES = 8_000_000;
/** Files on one message. */
export const ATTACHMENT_MAX_COUNT = 6;
/** Images the model can read when the profile supports vision. */
export const ATTACHMENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const HEADER = "Attached files (in your workspace):";
const BLOCK = new RegExp(`(?:^|\\n\\n)${HEADER.replace(/[()]/g, "\\$&")}\\n((?:- [^\\n]+(?:\\n|$))+)$`);
const LINE = /^- (uploads\/[A-Za-z0-9._-]+) \(([A-Za-z0-9._ -]+), ([a-z0-9.+-]+\/[a-z0-9.+-]+), (\d+) bytes\)$/;

export function isImageType(mimeType: string): boolean {
  return (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/** A file name safe to show and to use in a path: no separators, no markup. */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^\.+/, "").trim().slice(0, 80);
  return cleaned || "file";
}

export function safeMimeType(value: string | null | undefined): string {
  const type = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) && type.length <= 100 ? type : "application/octet-stream";
}

/** The message text with its attachments appended. */
export function withAttachments(text: string, files: readonly AttachmentRef[]): string {
  if (files.length === 0) return text;
  const lines = files.map((file) => `- ${file.path} (${file.name}, ${file.mimeType}, ${file.size} bytes)`);
  const block = `${HEADER}\n${lines.join("\n")}`;
  return text.trim() ? `${text.trim()}\n\n${block}` : block;
}

/** Inverse of `withAttachments`. Text without the block comes back unchanged. */
export function splitAttachments(content: string): { text: string; files: AttachmentRef[] } {
  const match = BLOCK.exec(content);
  if (!match) return { text: content, files: [] };
  const files: AttachmentRef[] = [];
  for (const line of (match[1] ?? "").split("\n")) {
    if (!line) continue;
    const parsed = LINE.exec(line);
    if (!parsed) return { text: content, files: [] };
    files.push({
      path: parsed[1] as string,
      name: parsed[2] as string,
      mimeType: parsed[3] as string,
      size: Number(parsed[4]),
    });
  }
  return { text: content.slice(0, match.index), files };
}
