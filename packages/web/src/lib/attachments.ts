import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, isImageType } from "@botanical/core";

/** A file chosen in the composer, not yet uploaded. */
export interface PendingFile {
  id: string;
  file: File;
  name: string;
  /** Object URL for an image thumbnail. Revoke it when the file leaves the composer. */
  previewUrl: string | null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 100) / 10} KB`;
  return `${Math.round(bytes / 100_000) / 10} MB`;
}

/** Names a pasted image gets, since the clipboard gives it a generic one. */
function nameFor(file: File, index: number): string {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  return `pasted-${index + 1}.${ext}`;
}

/** Which of `incoming` fit alongside `existing`, and a message for each one that did not. */
export function acceptFiles(
  existing: readonly PendingFile[],
  incoming: readonly File[],
): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of incoming) {
    if (existing.length + accepted.length >= ATTACHMENT_MAX_COUNT) {
      errors.push(`Attach at most ${ATTACHMENT_MAX_COUNT} files per message.`);
      break;
    }
    if (file.size === 0) {
      errors.push(`${file.name || "That file"} is empty.`);
    } else if (file.size > ATTACHMENT_MAX_BYTES) {
      errors.push(`${file.name || "That file"} is over ${ATTACHMENT_MAX_BYTES / 1_000_000} MB.`);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, errors };
}

export function toPending(files: readonly File[], offset = 0): PendingFile[] {
  return files.map((file, index) => ({
    id: crypto.randomUUID(),
    file,
    name: nameFor(file, offset + index),
    previewUrl: isImageType(file.type) ? URL.createObjectURL(file) : null,
  }));
}

export function releasePending(files: readonly PendingFile[]): void {
  for (const item of files) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}
