import { Buffer } from "node:buffer";

import { HttpError, isRecord } from "../http.ts";
import type { SpeechRequest } from "./types.ts";
import { logUpstreamFailure, postSpeech, speechUrl } from "./upstream.ts";

/** Encoded data-URL ceiling for Qwen ASR (OpenAI-compatible chat completions). */
export const QWEN_ENCODED_AUDIO_MAX_BYTES = 10_000_000;

/** Byte length of `data:<mime>;base64,<standard base64 of byteLength bytes>`. */
export function qwenDataUrlLength(mime: string, byteLength: number): number {
  const prefix = `data:${mime};base64,`;
  return prefix.length + 4 * Math.ceil(byteLength / 3);
}

/**
 * JSON POST `<base>/chat/completions`.
 * Audio is a data URL (`data:<mime>;base64,...`), which this API accepts.
 * Callers must stay at or under {@link QWEN_ENCODED_AUDIO_MAX_BYTES} for that URL.
 */
export async function transcribeQwen(input: SpeechRequest): Promise<string> {
  const mime = input.file.type || "application/octet-stream";
  if (qwenDataUrlLength(mime, input.file.size) > QWEN_ENCODED_AUDIO_MAX_BYTES) {
    throw new HttpError(413, "payload_too_large", "Recording is too large for this speech provider");
  }

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  if (dataUrl.length > QWEN_ENCODED_AUDIO_MAX_BYTES) {
    throw new HttpError(413, "payload_too_large", "Recording is too large for this speech provider");
  }

  const asrOptions: Record<string, unknown> = { enable_itn: false };
  if (input.language) asrOptions.language = input.language;

  const payload = await postSpeech({
    provider: input.provider,
    url: speechUrl(input.baseUrl, "chat/completions"),
    apiKey: input.apiKey,
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUrl } }],
        },
      ],
      stream: false,
      asr_options: asrOptions,
    }),
    json: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  return readQwenTranscript(payload, input.provider);
}

function readQwenTranscript(payload: unknown, provider: string): string {
  const content = qwenContent(payload);
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
    }
    if (parts.length > 0) return parts.join("");
  }
  logUpstreamFailure(provider, 200, "unexpected transcript shape", null);
  throw new HttpError(502, "transcription_failed", "Speech transcription failed");
}

function qwenContent(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  return first.message.content;
}
