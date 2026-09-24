"use client";

import { BotanicalClient } from "@botanical/core";
import { loadSession } from "@/lib/session";

let token: string | null = loadSession()?.token ?? null;
let client: BotanicalClient | null = null;

export function setClientToken(next: string | null): void {
  token = next;
}

export function getClient(): BotanicalClient {
  if (!client) {
    client = new BotanicalClient({
      baseUrl: "",
      getToken: () => token,
    });
  }
  return client;
}
