import { describe, expect, test } from "bun:test";
import {
  BROWSER_DICTATION_NOTE,
  NO_BACKEND_REASON,
  NO_RECORDER_REASON,
  buildTranscriptionForm,
  cappedDurationMs,
  fileNameForMime,
  formatElapsed,
  microphoneErrorMessage,
  parseDictationCapability,
  planDictation,
  readDictationSupport,
  selectDictationMimeType,
  speechErrorMessage,
  spliceTranscript,
  stripCodec,
  transcriptionFailureMessage,
  type BrowserDictationSupport,
  type DictationCapability,
} from "./dictation";

const serverCapability: DictationCapability = { mode: "server", maxBytes: 10_000_000, maxSeconds: 120 };
const browserCapability: DictationCapability = { mode: "browser", maxBytes: 10_000_000, maxSeconds: 120 };

const recording: BrowserDictationSupport = {
  hasMediaDevices: true,
  hasMediaRecorder: true,
  mimeType: "audio/webm;codecs=opus",
  hasSpeechRecognition: false,
};

describe("selectDictationMimeType", () => {
  test("prefers opus in webm", () => {
    expect(selectDictationMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  test("falls back to ogg, then mp4, and gives up when nothing is supported", () => {
    expect(selectDictationMimeType((type) => type === "audio/ogg" || type === "audio/mp4")).toBe("audio/ogg");
    expect(selectDictationMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(selectDictationMimeType(() => false)).toBeNull();
  });

  test("skips a probe that throws", () => {
    expect(
      selectDictationMimeType((type) => {
        if (type.startsWith("audio/webm")) throw new Error("unsupported");
        return type === "audio/ogg;codecs=opus";
      }),
    ).toBe("audio/ogg;codecs=opus");
  });
});

describe("planDictation", () => {
  test("uses the server when it has a backend and this browser can record", () => {
    expect(planDictation(serverCapability, { ...recording, hasSpeechRecognition: true })).toEqual({
      state: "server",
      mimeType: "audio/webm;codecs=opus",
      maxBytes: 10_000_000,
      maxSeconds: 120,
      disabledReason: null,
    });
  });

  test("stays unavailable in server mode when MediaRecorder or the microphone is missing", () => {
    expect(
      planDictation(serverCapability, { ...recording, hasMediaRecorder: false, mimeType: null, hasSpeechRecognition: true })
        .disabledReason,
    ).toBe(NO_RECORDER_REASON);
    expect(planDictation(serverCapability, { ...recording, hasMediaDevices: false }).state).toBe("unavailable");
    expect(planDictation(serverCapability, { ...recording, mimeType: null }).state).toBe("unavailable");
  });

  test("uses the browser when the server has no backend and speech recognition exists", () => {
    const plan = planDictation(browserCapability, { ...recording, hasSpeechRecognition: true, mimeType: null });
    expect(plan).toEqual({
      state: "browser",
      maxBytes: 10_000_000,
      maxSeconds: 120,
      disabledReason: null,
    });
  });

  test("explains when neither the server nor the browser can dictate", () => {
    expect(planDictation(browserCapability, { ...recording, hasSpeechRecognition: false }).disabledReason).toBe(
      NO_BACKEND_REASON,
    );
    expect(planDictation(null, recording).state).toBe("unavailable");
  });
});

describe("readDictationSupport", () => {
  test("reads recorder support and either speech recognition constructor", () => {
    function SpeechRecognition() {}
    function MediaRecorder() {}
    Object.assign(MediaRecorder, {
      isTypeSupported: (type: string) => type === "audio/mp4",
    });
    const support = readDictationSupport({
      webkitSpeechRecognition: SpeechRecognition,
      MediaRecorder,
      navigator: { mediaDevices: { getUserMedia() {} } },
    });
    expect(support).toEqual({
      hasMediaDevices: true,
      hasMediaRecorder: true,
      mimeType: "audio/mp4",
      hasSpeechRecognition: true,
    });
  });

  test("is empty when the window has neither API", () => {
    expect(readDictationSupport(undefined)).toEqual({
      hasMediaDevices: false,
      hasMediaRecorder: false,
      mimeType: null,
      hasSpeechRecognition: false,
    });
  });
});

describe("parseDictationCapability", () => {
  test("accepts the capabilities payload and ignores extra fields", () => {
    expect(
      parseDictationCapability({
        dictation: { mode: "server", maxBytes: 1000, maxSeconds: 30, baseUrl: "http://hidden" },
      }),
    ).toEqual({ mode: "server", maxBytes: 1000, maxSeconds: 30 });
  });

  test("keeps a server provider name and still ignores the endpoint", () => {
    expect(
      parseDictationCapability({
        dictation: { mode: "server", maxBytes: 10, maxSeconds: 2, provider: "xai", baseUrl: "http://hidden" },
      }),
    ).toEqual({ mode: "server", maxBytes: 10, maxSeconds: 2, provider: "xai" });
  });

  test("rejects a payload that cannot choose a mode", () => {
    expect(parseDictationCapability(null)).toBeNull();
    expect(parseDictationCapability({ dictation: { mode: "local", maxBytes: 1, maxSeconds: 1 } })).toBeNull();
    expect(parseDictationCapability({ dictation: { mode: "browser", maxBytes: 0, maxSeconds: 1 } })).toBeNull();
  });
});

describe("spliceTranscript", () => {
  test("inserts at the cursor and adds a space only where the neighbors need one", () => {
    expect(spliceTranscript("", "  hello ", 0, 0)).toEqual({ value: "hello", caret: 5 });
    expect(spliceTranscript("Hi", "there", 2, 2)).toEqual({ value: "Hi there", caret: 8 });
    expect(spliceTranscript("Hello world", "there", 0, 0)).toEqual({ value: "there Hello world", caret: 6 });
    expect(spliceTranscript("Say it", "please", 3, 3)).toEqual({ value: "Say please it", caret: 10 });
    expect(spliceTranscript("Hello", "   ", 5, 5)).toEqual({ value: "Hello", caret: 5 });
  });
});

describe("dictation messages", () => {
  test("formats elapsed time and names microphone failures", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(microphoneErrorMessage({ name: "NotAllowedError" })).toBe("Microphone permission was denied.");
    expect(microphoneErrorMessage({ name: "NotFoundError" })).toBe("No microphone was found.");
    expect(microphoneErrorMessage({ name: "NotReadableError" })).toBe("Couldn't use the microphone.");
    expect(speechErrorMessage("no-speech")).toBe("No speech detected.");
    expect(speechErrorMessage("aborted")).toBeNull();
  });

  test("maps upload failures without repeating secrets", () => {
    expect(transcriptionFailureMessage(413, "Request body is too large")).toBe("That recording is too large.");
    expect(transcriptionFailureMessage(401, "Authentication required")).toBe("Sign in again to use dictation.");
    expect(transcriptionFailureMessage(400, "language must be an ISO 639-1 code")).toBe(
      "language must be an ISO 639-1 code",
    );
    expect(transcriptionFailureMessage(502, "upstream said bearer sk-secret")).toBe("Transcription failed. Try again.");
    expect(transcriptionFailureMessage(500, null)).toBe("Transcription failed. Try again.");
  });

  test("caps the duration hint and names the file from the base media type", () => {
    expect(stripCodec("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(fileNameForMime("audio/webm;codecs=opus")).toBe("dictation.weba");
    expect(cappedDurationMs(120_050, 120)).toBe(120_000);
    const form = buildTranscriptionForm(new Blob([new Uint8Array([1, 2])], { type: "audio/webm;codecs=opus" }), 1500, 120);
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect(file instanceof File ? file.name : "").toBe("dictation.weba");
    expect(form.get("durationMs")).toBe("1500");
  });

  test("keeps the browser-vendor note stable", () => {
    expect(BROWSER_DICTATION_NOTE).toContain("browser");
  });
});
