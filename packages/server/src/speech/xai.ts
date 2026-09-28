import type { SpeechRequest } from "./types.ts";
import { postSpeech, requireText, speechUrl } from "./upstream.ts";

/**
 * Multipart POST `<base>/stt`.
 *
 * The configured model is always sent. The default is `grok-voice-transcribe-2.0`.
 * `format=true` is sent only together with `language` (the API rejects format without language).
 * The file part is appended last, which the API requires.
 */
export async function transcribeXai(input: SpeechRequest): Promise<string> {
  const body = new FormData();
  body.append("model", input.model);
  if (input.language) {
    body.append("language", input.language);
    body.append("format", "true");
  }
  body.append(
    "file",
    new File([input.file], input.filename, { type: input.file.type || "application/octet-stream" }),
  );

  const payload = await postSpeech({
    provider: input.provider,
    url: speechUrl(input.baseUrl, "stt"),
    apiKey: input.apiKey,
    body,
    json: false,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  return requireText(payload, input.provider);
}
