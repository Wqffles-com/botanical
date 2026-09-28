import type { SpeechRequest } from "./types.ts";
import { postSpeech, requireText, speechUrl } from "./upstream.ts";

/** Multipart POST `<base>/audio/transcriptions`. The key is optional (local servers). */
export async function transcribeOpenAiCompat(input: SpeechRequest): Promise<string> {
  const body = new FormData();
  body.append(
    "file",
    new File([input.file], input.filename, { type: input.file.type || "application/octet-stream" }),
  );
  body.append("model", input.model);
  body.append("response_format", "json");
  if (input.language) body.append("language", input.language);

  const payload = await postSpeech({
    provider: input.provider,
    url: speechUrl(input.baseUrl, "audio/transcriptions"),
    apiKey: input.apiKey,
    body,
    json: false,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  return requireText(payload, input.provider);
}
