import type { SttProvider } from "../config.ts";

/** Narrower than Bun's `fetch` so tests can pass a plain function. */
export type SpeechFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Values an adapter needs. Adapters do not read env or app config. */
export interface SpeechRequest {
  provider: SttProvider;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  file: Blob;
  filename: string;
  language?: string;
  /** Tests can replace global fetch. Production leaves this unset. */
  fetchImpl?: SpeechFetch;
  timeoutMs?: number;
}
