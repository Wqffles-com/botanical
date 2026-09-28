import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.ts";
import { baseEnv, bearer, login, readJson, setup } from "./helpers.ts";

const SECRET = "test-stt-key";
const LEAK = "upstream-secret-token";

describe("dictation config", () => {
  test("uses OpenAI when only OPENAI_API_KEY is set", () => {
    const config = loadConfig(baseEnv({ OPENAI_API_KEY: "sk-openai-test" }));
    expect(config.dictation).toEqual({
      mode: "server",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai-test",
      model: "gpt-4o-mini-transcribe",
      maxBytes: 10_000_000,
      maxSeconds: 120,
    });
  });

  test("lets BOTANICAL_STT_MODEL replace the OpenAI default model", () => {
    const config = loadConfig(
      baseEnv({ OPENAI_API_KEY: "sk-openai-test", BOTANICAL_STT_MODEL: "gpt-4o-transcribe" }),
    );
    expect(config.dictation.mode).toBe("server");
    if (config.dictation.mode !== "server") return;
    expect(config.dictation.model).toBe("gpt-4o-transcribe");
    expect(config.dictation.apiKey).toBe("sk-openai-test");
  });

  test("a custom base URL defaults to whisper-1 and does not reuse the OpenAI key", () => {
    const config = loadConfig(
      baseEnv({
        OPENAI_API_KEY: "sk-openai-test",
        BOTANICAL_STT_BASE_URL: "http://whisper:8000/v1/",
        BOTANICAL_STT_MODEL: "whisper-large-v3-turbo",
        BOTANICAL_STT_API_KEY: "gsk-test",
        BOTANICAL_STT_MAX_BYTES: "2000000",
        BOTANICAL_STT_MAX_SECONDS: "30",
      }),
    );
    expect(config.dictation).toEqual({
      mode: "server",
      baseUrl: "http://whisper:8000/v1",
      apiKey: "gsk-test",
      model: "whisper-large-v3-turbo",
      maxBytes: 2_000_000,
      maxSeconds: 30,
    });
  });

  test("a custom base URL without a key stays server-side and keyless", () => {
    const config = loadConfig(baseEnv({ BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1" }));
    expect(config.dictation.mode).toBe("server");
    if (config.dictation.mode !== "server") return;
    expect(config.dictation.model).toBe("whisper-1");
    expect(config.dictation.apiKey).toBeNull();
  });

  test("reads BOTANICAL_STT_API_KEY_FILE when the plain value is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "botanical-stt-"));
    try {
      const file = join(dir, "key");
      writeFileSync(file, " file-key \n");
      const config = loadConfig(
        baseEnv({
          BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1",
          BOTANICAL_STT_API_KEY: "  ",
          BOTANICAL_STT_API_KEY_FILE: file,
        }),
      );
      expect(config.dictation.mode).toBe("server");
      if (config.dictation.mode !== "server") return;
      expect(config.dictation.apiKey).toBe("file-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty key file is an error and a plain value wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "botanical-stt-"));
    try {
      const file = join(dir, "key");
      writeFileSync(file, "   \n");
      expect(() =>
        loadConfig(
          baseEnv({
            BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1",
            BOTANICAL_STT_API_KEY_FILE: file,
          }),
        ),
      ).toThrow(ConfigError);

      const config = loadConfig(
        baseEnv({
          BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1",
          BOTANICAL_STT_API_KEY: "plain-key",
          BOTANICAL_STT_API_KEY_FILE: join(dir, "missing"),
        }),
      );
      expect(config.dictation.mode).toBe("server");
      if (config.dictation.mode !== "server") return;
      expect(config.dictation.apiKey).toBe("plain-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("disables the backend and falls back when nothing is configured", () => {
    expect(loadConfig(baseEnv()).dictation.mode).toBe("browser");
    const disabled = loadConfig(
      baseEnv({ OPENAI_API_KEY: "sk-openai-test", BOTANICAL_STT_DISABLED: "true" }),
    );
    expect(disabled.dictation).toMatchObject({ mode: "browser", baseUrl: null, apiKey: null, model: null });
    expect(JSON.stringify(disabled.dictation)).not.toContain("sk-openai-test");
  });

  test("rejects a bad speech endpoint", () => {
    expect(() => loadConfig(baseEnv({ BOTANICAL_STT_BASE_URL: "ftp://example.com/v1" }))).toThrow(
      /BOTANICAL_STT_BASE_URL/,
    );
    expect(() =>
      loadConfig(baseEnv({ BOTANICAL_STT_BASE_URL: "http://user:secret@127.0.0.1:9/v1" })),
    ).toThrow(/credentials/);
  });
});

describe("transcription routes", () => {
  test("capabilities and transcription require auth", async () => {
    const { app } = setup({ OPENAI_API_KEY: "sk-openai-test" });
    const capabilities = await app.fetch(new Request("http://localhost/api/capabilities"));
    expect(capabilities.status).toBe(401);
    const upload = await app.fetch(
      new Request("http://localhost/api/transcriptions", { method: "POST", body: new FormData() }),
    );
    expect(upload.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(capabilities);
    expect(body.error.code).toBe("unauthorized");
  });

  test("capabilities report browser mode when no speech backend is configured", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/capabilities", { headers: bearer(token) }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{ dictation: { mode: string; maxBytes: number; maxSeconds: number } }>(response);
    expect(body.dictation).toEqual({ mode: "browser", maxBytes: 10_000_000, maxSeconds: 120 });
  });

  test("capabilities report server mode without the endpoint or key", async () => {
    const { app } = setup({ OPENAI_API_KEY: "sk-openai-test", BOTANICAL_STT_MODEL: "whisper-1" });
    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/capabilities", { headers: bearer(token) }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{ dictation: { mode: string; maxBytes: number; maxSeconds: number } }>(response);
    expect(body.dictation).toEqual({ mode: "server", maxBytes: 10_000_000, maxSeconds: 120 });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("sk-openai-test");
    expect(raw).not.toContain("api.openai.com");
    expect(raw).not.toContain("whisper-1");
    expect(raw).not.toContain("baseUrl");
  });

  test("rejects a missing file, an empty file, a bad type, a bad language, and a long duration", async () => {
    const { app } = setup({
      BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1",
      BOTANICAL_STT_MAX_SECONDS: "2",
    });
    const { token } = await login(app);

    const missing = await postAudio(app, token, (form) => {
      form.set("language", "en");
    });
    expect(missing.status).toBe(400);
    expect((await readJson<{ error: { message: string } }>(missing)).error.message).toBe("file is required");

    const empty = await postAudio(app, token, (form) => {
      form.set("file", new File([], "clip.webm", { type: "audio/webm" }));
    });
    expect(empty.status).toBe(400);
    expect((await readJson<{ error: { message: string } }>(empty)).error.message).toBe("file is empty");

    const badType = await postAudio(app, token, (form) => {
      form.set("file", new File([new Uint8Array([1])], "clip.txt", { type: "text/plain" }));
    });
    expect(badType.status).toBe(415);
    expect((await readJson<{ error: { code: string } }>(badType)).error.code).toBe("unsupported_media_type");

    const badLanguage = await postAudio(app, token, (form) => {
      form.set("file", clip());
      form.set("language", "english");
    });
    expect(badLanguage.status).toBe(400);
    expect((await readJson<{ error: { message: string } }>(badLanguage)).error.message).toContain("ISO 639-1");

    const tooLong = await postAudio(app, token, (form) => {
      form.set("file", clip());
      form.set("durationMs", "5000");
    });
    expect(tooLong.status).toBe(400);
    expect((await readJson<{ error: { message: string } }>(tooLong)).error.message).toContain("longer than 2 seconds");
  });

  test("rejects an upload larger than BOTANICAL_STT_MAX_BYTES with 413", async () => {
    const { app } = setup({
      BOTANICAL_STT_BASE_URL: "http://127.0.0.1:9/v1",
      BOTANICAL_STT_MAX_BYTES: "1000",
    });
    const { token } = await login(app);
    const response = await postAudio(app, token, (form) => {
      form.set("file", new File([new Uint8Array(5_000)], "clip.webm", { type: "audio/webm" }));
    });
    expect(response.status).toBe(413);
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe("payload_too_large");

    const stripped = await postAudio(app, token, (form) => {
      form.set("file", new File([new Uint8Array(5_000)], "clip.webm", { type: "audio/webm" }));
    }, { dropContentLength: true });
    expect(stripped.status).toBe(413);
  });

  test("forwards audio to /audio/transcriptions and returns the text", async () => {
    const seen: Record<string, string | null> = {};
    const upstream = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url);
        seen.pathname = url.pathname;
        seen.authorization = request.headers.get("authorization");
        const form = await request.formData();
        seen.model = stringField(form.get("model"));
        seen.language = stringField(form.get("language"));
        seen.format = stringField(form.get("response_format"));
        const file = form.get("file");
        seen.file = file instanceof File ? `${file.name}:${file.size}:${file.type}` : null;
        return Response.json({ text: "hello garden" });
      },
    });
    try {
      const { app } = setup({
        BOTANICAL_STT_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
        BOTANICAL_STT_API_KEY: SECRET,
        BOTANICAL_STT_MODEL: "whisper-1",
      });
      const { token } = await login(app);
      const response = await postAudio(app, token, (form) => {
        form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "clip.weba", { type: "audio/webm;codecs=opus" }));
        form.set("language", "EN");
        form.set("durationMs", "1500");
      });
      expect(response.status).toBe(200);
      expect(await readJson<{ text: string }>(response)).toEqual({ text: "hello garden" });
      expect(seen.pathname).toBe("/v1/audio/transcriptions");
      expect(seen.authorization).toBe(`Bearer ${SECRET}`);
      expect(seen.model).toBe("whisper-1");
      expect(seen.language).toBe("en");
      expect(seen.format).toBe("json");
      expect(seen.file?.startsWith("dictation.webm:4:")).toBe(true);
      const raw = JSON.stringify({ text: "hello garden" });
      expect(raw).not.toContain(SECRET);
    } finally {
      await upstream.stop(true);
    }
  });

  test("omits the bearer header when no key is configured", async () => {
    let authorization: string | null = "unset";
    const upstream = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        authorization = request.headers.get("authorization");
        return Response.json({ text: "local" });
      },
    });
    try {
      const { app } = setup({ BOTANICAL_STT_BASE_URL: `http://127.0.0.1:${upstream.port}/v1` });
      const { token } = await login(app);
      const response = await postAudio(app, token, (form) => {
        form.set("file", clip());
      });
      expect(response.status).toBe(200);
      expect(await readJson<{ text: string }>(response)).toEqual({ text: "local" });
      expect(authorization).toBeNull();
    } finally {
      await upstream.stop(true);
    }
  });

  test("maps an upstream failure to 502 without the key or upstream body", async () => {
    const upstream = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response(JSON.stringify({ error: { message: LEAK, key: SECRET } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const { app } = setup({
        BOTANICAL_STT_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
        BOTANICAL_STT_API_KEY: SECRET,
      });
      const { token } = await login(app);
      const response = await postAudio(app, token, (form) => {
        form.set("file", clip());
      });
      expect(response.status).toBe(502);
      const raw = await response.text();
      expect(raw).not.toContain(SECRET);
      expect(raw).not.toContain(LEAK);
      expect(JSON.parse(raw)).toEqual({
        error: { code: "transcription_failed", message: "Speech transcription failed" },
      });
    } finally {
      await upstream.stop(true);
    }
  });
});

function clip(): File {
  return new File([new Uint8Array([7, 8, 9])], "clip.weba", { type: "audio/webm" });
}

function stringField(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

async function postAudio(
  app: ReturnType<typeof setup>["app"],
  token: string,
  fill: (form: FormData) => void,
  options: { dropContentLength?: boolean } = {},
): Promise<Response> {
  const form = new FormData();
  fill(form);
  const request = new Request("http://localhost/api/transcriptions", {
    method: "POST",
    headers: bearer(token),
    body: form,
  });
  if (!options.dropContentLength) return app.fetch(request);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return app.fetch(
    new Request(request.url, {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
    }),
  );
}

