import { Buffer } from "node:buffer";

import { HttpError } from "../http.ts";
import type { SpeechRequest } from "./types.ts";
import { postSpeech, requireText, speechUrl } from "./upstream.ts";

/** OpenRouter JSON `input_audio.format` values. */
const FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/**
 * JSON POST `<base>/audio/transcriptions`.
 * `input_audio.data` is raw base64, not a data URL.
 */
export async function transcribeOpenRouter(input: SpeechRequest): Promise<string> {
  const format = openRouterFormat(input.file.type);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const payloadBody: Record<string, unknown> = {
    model: input.model,
    input_audio: {
      data: Buffer.from(bytes).toString("base64"),
      format,
    },
  };
  if (input.language) payloadBody.language = input.language;

  const payload = await postSpeech({
    provider: input.provider,
    url: speechUrl(input.baseUrl, "audio/transcriptions"),
    apiKey: input.apiKey,
    body: JSON.stringify(payloadBody),
    json: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  return requireText(payload, input.provider);
}

function openRouterFormat(mime: string): string {
  const base = (mime.split(";", 1)[0] ?? "").trim().toLowerCase();
  const format = FORMATS[base];
  if (!format) {
    throw new HttpError(415, "unsupported_media_type", "Audio type is not supported");
  }
  return format;
}
