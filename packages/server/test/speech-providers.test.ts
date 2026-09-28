import { Buffer } from "node:buffer";
import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/http.ts";
import { QWEN_ENCODED_AUDIO_MAX_BYTES, qwenDataUrlLength } from "../src/speech/qwen.ts";
import { transcribeAudio, type SpeechRequest } from "../src/speech/transcribe.ts";
import type { SpeechFetch } from "../src/speech/types.ts";
import type { SttProvider } from "../src/config.ts";

const SECRET = "sk-test-secret-value";
const LEAK = "upstream-secret-token";

const PROVIDERS = ["openai-compat", "openrouter", "xai", "qwen"] as const satisfies readonly SttProvider[];

const DEFAULTS: Record<SttProvider, { baseUrl: string; model: string }> = {
  "openai-compat": { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/whisper-large-v3" },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-voice-transcribe-2.0" },
  qwen: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-asr-flash",
  },
};

describe("speech adapters", () => {
  test("openai-compat posts multipart audio and reads text", async () => {
    const { fetchImpl, calls } = captureFetch(Response.json({ text: "hello garden" }));
    const text = await transcribeAudio(
      request("openai-compat", {
        fetchImpl,
        language: "en",
        apiKey: SECRET,
        baseUrl: "https://example.test/v1/",
        model: "whisper-1",
      }),
    );
    expect(text).toBe("hello garden");
    const call = calls[0];
    expect(call?.url).toBe("https://example.test/v1/audio/transcriptions");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(call?.headers.get("content-type")).toBeNull();
    expect(formEntries(call?.body)).toEqual([
      { name: "file", value: "file:dictation.webm:audio/webm:4" },
      { name: "model", value: "whisper-1" },
      { name: "response_format", value: "json" },
      { name: "language", value: "en" },
    ]);
  });

  test("openai-compat omits the bearer header when no key is set", async () => {
    const { fetchImpl, calls } = captureFetch(Response.json({ text: "local" }));
    await transcribeAudio(request("openai-compat", { fetchImpl, apiKey: null }));
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  test("openrouter sends raw base64, maps formats, and reads text", async () => {
    const formats = [
      ["audio/webm", "webm"],
      ["audio/ogg", "ogg"],
      ["audio/mp4", "m4a"],
      ["audio/mpeg", "mp3"],
      ["audio/wav", "wav"],
      ["audio/x-wav", "wav"],
    ] as const;
    for (const [mime, format] of formats) {
      const { fetchImpl, calls } = captureFetch(Response.json({ text: "heard", usage: { seconds: 1 } }));
      const text = await transcribeAudio(
        request("openrouter", {
          fetchImpl,
          language: mime === "audio/webm" ? "en" : undefined,
          file: new File([new Uint8Array([9, 8, 7])], "clip", { type: mime }),
        }),
      );
      expect(text).toBe("heard");
      const call = calls[0];
      expect(call?.url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
      expect(call?.method).toBe("POST");
      expect(call?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
      expect(call?.headers.get("content-type")).toBe("application/json");
      const body = jsonBody(call?.body);
      const audio = body.input_audio as { data: string; format: string };
      expect(audio.format).toBe(format);
      expect(audio.data).toBe(Buffer.from([9, 8, 7]).toString("base64"));
      expect(audio.data).not.toContain("data:");
      expect(body.model).toBe(DEFAULTS.openrouter.model);
      if (mime === "audio/webm") expect(body.language).toBe("en");
      else expect(body.language).toBeUndefined();
    }
  });

  test("openrouter rejects an unmapped audio type before calling upstream", async () => {
    let called = false;
    const error = await failure(
      request("openrouter", {
        file: new File([new Uint8Array([1])], "clip", { type: "audio/flac" }),
        fetchImpl: async () => {
          called = true;
          return Response.json({ text: "nope" });
        },
      }),
    );
    expect(called).toBe(false);
    expect(error.status).toBe(415);
    expect(error.code).toBe("unsupported_media_type");
  });

  test("xAI sends the model, puts the file last, and sets format only with language", async () => {
    const withLanguage = captureFetch(
      Response.json({ text: "xai text", language: "en", duration: 1, words: [] }),
    );
    const text = await transcribeAudio(
      request("xai", {
        fetchImpl: withLanguage.fetchImpl,
        language: "en",
        filename: "note.webm",
        file: new File([new Uint8Array([1, 2, 3, 4])], "note.webm", { type: "audio/webm" }),
        baseUrl: "https://api.x.ai/v1",
        model: "grok-voice-transcribe-2.0",
      }),
    );
    expect(text).toBe("xai text");
    const call = withLanguage.calls[0];
    expect(call?.url).toBe("https://api.x.ai/v1/stt");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(call?.headers.get("content-type")).toBeNull();
    expect(formEntries(call?.body)).toEqual([
      { name: "model", value: "grok-voice-transcribe-2.0" },
      { name: "language", value: "en" },
      { name: "format", value: "true" },
      { name: "file", value: "file:note.webm:audio/webm:4" },
    ]);

    const bare = captureFetch(Response.json({ text: "bare" }));
    await transcribeAudio(request("xai", { fetchImpl: bare.fetchImpl }));
    const names = formEntries(bare.calls[0]?.body).map((entry) => entry.name);
    expect(names).toEqual(["model", "file"]);
  });

  test("qwen sends a data URL under the chat-completions API and reads string or array content", async () => {
    const stringBody = captureFetch(Response.json({ choices: [{ message: { content: "plain" } }] }));
    expect(await transcribeAudio(request("qwen", { fetchImpl: stringBody.fetchImpl, language: "en" }))).toBe("plain");
    const call = stringBody.calls[0];
    expect(call?.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(call?.headers.get("content-type")).toBe("application/json");
    const body = jsonBody(call?.body);
    expect(body.model).toBe("qwen3-asr-flash");
    expect(body.stream).toBe(false);
    expect(body.asr_options).toEqual({ enable_itn: false, language: "en" });
    const messages = body.messages as Array<{ content: Array<{ input_audio: { data: string } }> }>;
    const data = messages[0]?.content?.[0]?.input_audio?.data ?? "";
    expect(data.startsWith("data:audio/webm;base64,")).toBe(true);
    expect(Buffer.from(data.slice("data:audio/webm;base64,".length), "base64")).toEqual(Buffer.from([1, 2, 3, 4]));

    const arrayBody = captureFetch(
      Response.json({ choices: [{ message: { content: [{ text: "hello " }, { text: "garden" }, { type: "other" }] } }] }),
    );
    expect(await transcribeAudio(request("qwen", { fetchImpl: arrayBody.fetchImpl }))).toBe("hello garden");
    expect(jsonBody(arrayBody.calls[0]?.body).asr_options).toEqual({ enable_itn: false });
  });

  test("qwen rejects anything other than string or text-part content", async () => {
    for (const payload of [
      { choices: [{ message: { content: [{ type: "text" }] } }] },
      { choices: [{ message: { content: 12 } }] },
      { choices: [] },
      { choices: [{ message: {} }] },
      {},
    ]) {
      const error = await failure(request("qwen", { fetchImpl: async () => Response.json(payload) }));
      expect(error.status).toBe(502);
      expect(error.message).toBe("Speech transcription failed");
      expect(error.message).not.toContain("text");
    }
  });

  test("qwen data URL length matches standard base64 and blocks anything over 10 MB", async () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6]) {
      const mime = "audio/webm";
      const actual = `data:${mime};base64,${Buffer.from(new Uint8Array(n)).toString("base64")}`.length;
      expect(qwenDataUrlLength(mime, n)).toBe(actual);
    }
    const mime = "audio/webm";
    const over = smallestEncodedOver(mime);
    expect(qwenDataUrlLength(mime, over)).toBeGreaterThan(QWEN_ENCODED_AUDIO_MAX_BYTES);
    expect(qwenDataUrlLength(mime, over - 1)).toBeLessThanOrEqual(QWEN_ENCODED_AUDIO_MAX_BYTES);

    let called = false;
    const error = await failure(
      request("qwen", {
        file: new File([new Uint8Array(over)], "big.webm", { type: mime }),
        filename: "big.webm",
        fetchImpl: async () => {
          called = true;
          return Response.json({ choices: [{ message: { content: "nope" } }] });
        },
      }),
    );
    expect(called).toBe(false);
    expect(error.status).toBe(413);
    expect(error.code).toBe("payload_too_large");
    expect(error.message).toBe("Recording is too large for this speech provider");
  });

  for (const provider of PROVIDERS) {
    test(`${provider} maps upstream failures to a generic 502`, async () => {
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        const body = `${SECRET} Authorization: Bearer ${SECRET} ${LEAK} ${"x".repeat(400)}`;
        const http = await failure(
          request(provider, {
            fetchImpl: async () => new Response(body, { status: 503 }),
          }),
        );
        expect(http.status).toBe(502);
        expect(http.code).toBe("transcription_failed");
        expect(http.message).toBe("Speech transcription failed");
        expect(http.message).not.toContain(SECRET);
        expect(http.message).not.toContain(LEAK);

        const invalid = await failure(
          request(provider, { fetchImpl: async () => new Response("not-json", { status: 200 }) }),
        );
        expect(invalid.status).toBe(502);
        expect(invalid.message).not.toContain("not-json");

        const network = await failure(
          request(provider, {
            fetchImpl: async () => {
              throw new Error(`connect ${SECRET}`);
            },
          }),
        );
        expect(network.status).toBe(502);
        expect(network.message).toBe("Speech transcription failed");
        expect(network.message).not.toContain(SECRET);

        const timeout = await failure(
          request(provider, {
            fetchImpl: async () => {
              const error = new Error(`timed out ${SECRET}`);
              error.name = "TimeoutError";
              throw error;
            },
          }),
        );
        expect(timeout.status).toBe(502);
        expect(timeout.message).toBe("Speech transcription timed out");
        expect(timeout.message).not.toContain(SECRET);
      } finally {
        console.warn = original;
      }

      const logged = warnings.join("\n");
      expect(logged).toContain(`provider=${provider}`);
      expect(logged).toContain("status=503");
      expect(logged).toContain(LEAK);
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain(`Bearer ${SECRET}`);
      const snippetLine = warnings.find((line) => line.includes("status=503"));
      expect(snippetLine).toBeDefined();
      const marker = "body=";
      const snippet = JSON.parse(snippetLine?.slice(snippetLine.indexOf(marker) + marker.length) ?? '""') as string;
      expect(snippet.length).toBeLessThanOrEqual(300);
      expect(snippet).toContain("[redacted]");
      expect(snippet).toContain(LEAK);
      expect(warnings.some((line) => line.includes("status=network"))).toBe(true);
      expect(warnings.some((line) => line.includes("invalid json"))).toBe(true);
      expect(warnings.some((line) => line.includes("timeout"))).toBe(true);
    });
  }
});

function request(provider: SttProvider, overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  const defaults = DEFAULTS[provider];
  return {
    provider,
    baseUrl: defaults.baseUrl,
    apiKey: SECRET,
    model: defaults.model,
    file: new File([new Uint8Array([1, 2, 3, 4])], "dictation.webm", { type: "audio/webm" }),
    filename: "dictation.webm",
    ...overrides,
  };
}

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
}

function captureFetch(response: Response): { fetchImpl: SpeechFetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: SpeechFetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ?? null,
    });
    return response;
  };
  return { fetchImpl, calls };
}

async function failure(input: SpeechRequest): Promise<HttpError> {
  try {
    await transcribeAudio(input);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("expected transcription to fail");
}

function formEntries(body: BodyInit | null | undefined): Array<{ name: string; value: string }> {
  if (!(body instanceof FormData)) throw new Error("expected multipart body");
  return [...body.entries()].map(([name, value]) => ({
    name,
    value: fileLabel(value),
  }));
}

function fileLabel(value: unknown): string {
  if (typeof value === "object" && value !== null && "name" in value && "size" in value && "type" in value) {
    const file = value as File;
    return `file:${file.name}:${file.type}:${file.size}`;
  }
  return String(value);
}

function jsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

function smallestEncodedOver(mime: string): number {
  const prefix = `data:${mime};base64,`.length;
  const minCeil = Math.floor((QWEN_ENCODED_AUDIO_MAX_BYTES - prefix) / 4) + 1;
  return 3 * (minCeil - 1) + 1;
}
