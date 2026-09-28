export const BROWSER_DICTATION_NOTE =
  "Audio is processed by the browser's speech service, not this server.";

export const NO_BACKEND_REASON =
  "Dictation isn't configured on this server and this browser has no built-in speech recognition.";

export const NO_RECORDER_REASON = "This browser can't record audio for dictation.";

export const CHECKING_REASON = "Checking whether dictation is available.";

export const CAPABILITY_FAILED_REASON = "Couldn't check whether dictation is available.";

/** MIME types the server accepts, preferred first. Codec parameters are included when browsers require them. */
export const DICTATION_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
] as const;

const SERVER_AUDIO_BASE_TYPES = new Set<string>([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

// `.weba` keeps audio/webm through multipart parsers that relabel `.webm` as video/webm.
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": "weba",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export interface DictationCapability {
  mode: "server" | "browser";
  maxBytes: number;
  maxSeconds: number;
}

export interface BrowserDictationSupport {
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  mimeType: string | null;
  hasSpeechRecognition: boolean;
}

export type DictationPlan =
  | {
      state: "server";
      mimeType: string;
      maxBytes: number;
      maxSeconds: number;
      disabledReason: null;
    }
  | {
      state: "browser";
      maxBytes: number;
      maxSeconds: number;
      disabledReason: null;
    }
  | {
      state: "unavailable";
      disabledReason: string;
    };

export interface DictationWindowLike {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  MediaRecorder?: unknown;
  navigator?: {
    mediaDevices?: {
      getUserMedia?: unknown;
    };
  };
}

export function stripCodec(mime: string): string {
  const base = mime.split(";", 1)[0] ?? "";
  return base.trim().toLowerCase();
}

export function isServerAudioType(mime: string): boolean {
  return SERVER_AUDIO_BASE_TYPES.has(stripCodec(mime));
}

export function selectDictationMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of DICTATION_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // A broken check is the same as "not supported".
    }
  }
  return null;
}

export function speechRecognitionConstructor(
  win: DictationWindowLike | null | undefined,
): (new () => unknown) | null {
  if (!win) return null;
  const ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as new () => unknown) : null;
}

export function readDictationSupport(win: DictationWindowLike | null | undefined): BrowserDictationSupport {
  const hasMediaDevices = Boolean(
    win?.navigator?.mediaDevices && typeof win.navigator.mediaDevices.getUserMedia === "function",
  );
  const recorder = win?.MediaRecorder;
  const hasMediaRecorder = typeof recorder === "function";
  const isTypeSupported = mimeSupport(recorder);
  return {
    hasMediaDevices,
    hasMediaRecorder,
    mimeType: hasMediaRecorder && isTypeSupported ? selectDictationMimeType(isTypeSupported) : null,
    hasSpeechRecognition: speechRecognitionConstructor(win) !== null,
  };
}

export function planDictation(
  capability: DictationCapability | null,
  support: BrowserDictationSupport,
): DictationPlan {
  if (!capability) {
    return { state: "unavailable", disabledReason: CAPABILITY_FAILED_REASON };
  }
  if (capability.mode === "server") {
    if (support.hasMediaDevices && support.hasMediaRecorder && support.mimeType && isServerAudioType(support.mimeType)) {
      return {
        state: "server",
        mimeType: support.mimeType,
        maxBytes: capability.maxBytes,
        maxSeconds: capability.maxSeconds,
        disabledReason: null,
      };
    }
    return { state: "unavailable", disabledReason: NO_RECORDER_REASON };
  }
  if (support.hasSpeechRecognition) {
    return {
      state: "browser",
      maxBytes: capability.maxBytes,
      maxSeconds: capability.maxSeconds,
      disabledReason: null,
    };
  }
  return { state: "unavailable", disabledReason: NO_BACKEND_REASON };
}

export function parseDictationCapability(body: unknown): DictationCapability | null {
  if (!body || typeof body !== "object") return null;
  const dictation = (body as { dictation?: unknown }).dictation;
  if (!dictation || typeof dictation !== "object") return null;
  const record = dictation as Record<string, unknown>;
  if (record.mode !== "server" && record.mode !== "browser") return null;
  if (!isPositiveNumber(record.maxBytes) || !isPositiveNumber(record.maxSeconds)) return null;
  return { mode: record.mode, maxBytes: record.maxBytes, maxSeconds: record.maxSeconds };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function fileNameForMime(mime: string): string {
  const ext = AUDIO_EXTENSIONS[stripCodec(mime)] ?? "audio";
  return `dictation.${ext}`;
}

/**
 * Insert a transcript at the selection. A space is added on either side when the
 * surrounding text is not already whitespace. An empty transcript leaves the value unchanged.
 */
export function spliceTranscript(
  current: string,
  transcript: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; caret: number } {
  const text = transcript.trim();
  const start = clamp(selectionStart, 0, current.length);
  const end = clamp(selectionEnd, start, current.length);
  if (!text) return { value: current, caret: start };
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const insertion = `${lead}${text}${trail}`;
  return { value: before + insertion + after, caret: before.length + insertion.length };
}

export function microphoneErrorMessage(error: unknown): string | null {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone permission was denied.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Couldn't use the microphone.";
  }
  return null;
}

export function speechErrorMessage(code: string | undefined): string | null {
  if (!code || code === "aborted") return null;
  if (code === "not-allowed" || code === "service-not-allowed") return "Microphone permission was denied.";
  if (code === "audio-capture") return "No microphone was found.";
  if (code === "no-speech") return "No speech detected.";
  return "Speech recognition failed.";
}

export function transcriptionFailureMessage(status: number, serverMessage: string | null): string {
  if (status === 413) return "That recording is too large.";
  if (status === 401 || status === 403) return "Sign in again to use dictation.";
  if (serverMessage && isSafeClientMessage(serverMessage)) return serverMessage.trim();
  return "Transcription failed. Try again.";
}

export function readApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

/** Cap the duration hint at the server limit so a timer that fires a few milliseconds late is not rejected. */
export function cappedDurationMs(elapsedMs: number, maxSeconds: number): number {
  const elapsed = Math.max(0, Math.round(elapsedMs));
  return Math.min(elapsed, maxSeconds * 1000);
}

export function buildTranscriptionForm(blob: Blob, elapsedMs: number, maxSeconds: number): FormData {
  const type = blob.type || "application/octet-stream";
  const file = new File([blob], fileNameForMime(type), { type });
  const form = new FormData();
  form.set("file", file);
  form.set("durationMs", String(cappedDurationMs(elapsedMs, maxSeconds)));
  return form;
}

function mimeSupport(recorder: unknown): ((type: string) => boolean) | null {
  if (typeof recorder !== "function") return null;
  const isTypeSupported = (recorder as { isTypeSupported?: unknown }).isTypeSupported;
  if (typeof isTypeSupported !== "function") return null;
  return (type: string) => {
    try {
      return Boolean((isTypeSupported as (value: string) => boolean).call(recorder, type));
    } catch {
      return false;
    }
  };
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function errorName(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("name" in error)) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function isSafeClientMessage(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 180) return false;
  return !/bearer|api[_ -]?key|authorization|\bsk-|secret/i.test(text);
}
