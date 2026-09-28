import { HttpError, isRecord } from "./http.ts";

export const STT_TIMEOUT_MS = 60_000;

export interface TranscribeRequest {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  file: Blob;
  filename: string;
  language?: string;
  /** Tests can replace global fetch. Production leaves this unset. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Whisper-compatible endpoint. `baseUrl` is the API root, for example `https://api.openai.com/v1`. */
export function transcriptionEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

/**
 * POST multipart audio to a Whisper-compatible `/audio/transcriptions` endpoint.
 * Failures are generic: the API key and the upstream body are not returned.
 */
export async function transcribeAudio(input: TranscribeRequest): Promise<string> {
  const headers = new Headers();
  if (input.apiKey) headers.set("authorization", `Bearer ${input.apiKey}`);

  const body = new FormData();
  const named = new File([input.file], input.filename, {
    type: input.file.type || "application/octet-stream",
  });
  body.set("file", named);
  body.set("model", input.model);
  body.set("response_format", "json");
  if (input.language) body.set("language", input.language);

  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(transcriptionEndpoint(input.baseUrl), {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? STT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HttpError(
      502,
      "transcription_failed",
      isTimeout(error) ? "Speech transcription timed out" : "Speech transcription failed",
    );
  }

  if (!response.ok) {
    await drain(response);
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }
  return payload.text;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // The client still receives a generic 502.
  }
}
