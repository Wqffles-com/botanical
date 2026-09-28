import { HttpError, json } from "../http.ts";
import { authed, type RequestContext, type Router } from "../router.ts";
import { resolveSttConfig, type ResolvedStt, type SttResolveContext } from "../speech/index.ts";
import { transcribeAudio } from "../speech/transcribe.ts";

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

/** Multipart parsers rename a few audio types from the filename. Map them back. */
const AUDIO_ALIASES: Record<string, string> = {
  "video/webm": "audio/webm",
  "audio/x-m4a": "audio/mp4",
  "video/mp4": "audio/mp4",
};

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function registerTranscription(router: Router): void {
  router.add(
    "GET",
    "/api/capabilities",
    authed(async (ctx) => {
      const resolved = await resolveSttConfig(sttContext(ctx));
      if (resolved.mode === "browser") {
        return json(200, {
          dictation: {
            mode: "browser",
            maxBytes: resolved.limits.maxBytes,
            maxSeconds: resolved.limits.maxSeconds,
          },
        });
      }
      return json(200, {
        dictation: {
          mode: "server",
          provider: resolved.provider,
          maxBytes: resolved.limits.maxBytes,
          maxSeconds: resolved.limits.maxSeconds,
        },
      });
    }),
  );

  router.add(
    "POST",
    "/api/transcriptions",
    authed(async (ctx) => {
      const resolved = await resolveSttConfig(sttContext(ctx));
      if (resolved.mode !== "server") {
        throw new HttpError(503, "dictation_unavailable", "Dictation is not configured on this server");
      }
      const upload = await readAudioUpload(ctx.request, resolved.limits);
      const text = await transcribeAudio({
        provider: resolved.provider,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        file: upload.file,
        filename: upload.filename,
        ...(upload.language ? { language: upload.language } : {}),
      });
      return json(200, { text });
    }),
  );
}

interface AudioUpload {
  file: File;
  filename: string;
  language?: string;
}

/** v0 has a single account. A later multi-user layer replaces this with the real user id. */
function sttContext(ctx: RequestContext): SttResolveContext {
  return { config: ctx.config, userId: ctx.session ? "operator" : null };
}

async function readAudioUpload(
  request: Request,
  limits: Extract<ResolvedStt, { mode: "server" }>["limits"],
): Promise<AudioUpload> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || declared.length > 12 || Number(declared) > limits.maxBytes)) {
    throw new HttpError(413, "payload_too_large", "Request body is too large");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be multipart/form-data");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_body", "Could not read the upload");
  }

  const raw = form.get("file");
  if (!(raw instanceof File)) {
    throw new HttpError(400, "invalid_body", "file is required");
  }
  if (raw.size === 0) {
    throw new HttpError(400, "invalid_body", "file is empty");
  }
  if (raw.size > limits.maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large");
  }

  const mediaType = audioMediaType(raw.type);
  if (!AUDIO_TYPES.has(mediaType)) {
    throw new HttpError(415, "unsupported_media_type", "Audio type is not supported");
  }
  const file = new File([raw], `dictation.${AUDIO_EXTENSIONS[mediaType] ?? "audio"}`, { type: mediaType });

  const language = readLanguage(form.get("language"));
  readDuration(form.get("durationMs"), limits.maxSeconds);

  return {
    file,
    filename: file.name,
    ...(language ? { language } : {}),
  };
}

/** Drop codec parameters (`audio/webm;codecs=opus` → `audio/webm`) and undo filename sniffing. */
export function audioMediaType(value: string): string {
  const base = (value.split(";", 1)[0] ?? "").trim().toLowerCase();
  return AUDIO_ALIASES[base] ?? base;
}

function readLanguage(value: FormDataEntryValue | null): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_body", "language must be an ISO 639-1 code");
  }
  const text = value.trim();
  if (text === "") return undefined;
  if (!/^[A-Za-z]{2}$/.test(text)) {
    throw new HttpError(400, "invalid_body", "language must be an ISO 639-1 code");
  }
  return text.toLowerCase();
}

function readDuration(value: FormDataEntryValue | null, maxSeconds: number): void {
  if (value === null) return;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_body", "durationMs must be an integer number of milliseconds");
  }
  const text = value.trim();
  if (text === "") return;
  if (!/^\d+$/.test(text)) {
    throw new HttpError(400, "invalid_body", "durationMs must be an integer number of milliseconds");
  }
  const ms = Number(text);
  if (!Number.isSafeInteger(ms)) {
    throw new HttpError(400, "invalid_body", "durationMs must be an integer number of milliseconds");
  }
  if (ms > maxSeconds * 1000) {
    throw new HttpError(400, "invalid_body", `Recording is longer than ${maxSeconds} seconds`);
  }
}
