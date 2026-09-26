import { BotanicalClient } from "@botanical/core";
import { cookies } from "next/headers";

export function botanicalApiUrl(): string {
  return (process.env.BOTANICAL_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
}

/**
 * Server-side client. Forwards the incoming cookie jar to the Botanical
 * API so session checks in RSC / middleware stay aligned with the browser.
 */
export async function createServerClient(): Promise<BotanicalClient> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  return new BotanicalClient({
    baseUrl: botanicalApiUrl(),
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookieHeader) headers.set("cookie", cookieHeader);
      return fetch(input, { ...init, headers, cache: "no-store" });
    },
  });
}
