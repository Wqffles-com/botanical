import { HttpError } from "../http.ts";
import { transcribeOpenAiCompat } from "./openai-compat.ts";
import { transcribeOpenRouter } from "./openrouter.ts";
import { transcribeQwen } from "./qwen.ts";
import type { SpeechRequest } from "./types.ts";
import { transcribeXai } from "./xai.ts";

export type { SpeechRequest };

/** Dispatch to the provider adapter. The adapter receives only this request. */
export async function transcribeAudio(input: SpeechRequest): Promise<string> {
  switch (input.provider) {
    case "openai-compat":
      return transcribeOpenAiCompat(input);
    case "openrouter":
      return transcribeOpenRouter(input);
    case "xai":
      return transcribeXai(input);
    case "qwen":
      return transcribeQwen(input);
    default: {
      const unknown: never = input.provider;
      void unknown;
      throw new HttpError(502, "transcription_failed", "Speech transcription failed");
    }
  }
}
