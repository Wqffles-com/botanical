import { AGENT_PICTURE_MAX, isAgentPicture } from "@botanical/core";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/** Center-crop a file to a small JPEG data URL the agent API will store. */
export async function fileToAgentPicture(file: File): Promise<string> {
  if (!ACCEPT.includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image.");
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    let url = canvas.toDataURL("image/jpeg", 0.86);
    if (url.length > AGENT_PICTURE_MAX) url = canvas.toDataURL("image/jpeg", 0.7);
    if (url.length > AGENT_PICTURE_MAX) url = canvas.toDataURL("image/jpeg", 0.55);
    if (!isAgentPicture(url)) throw new Error("That image is still too large.");
    return url;
  } finally {
    bitmap.close();
  }
}
