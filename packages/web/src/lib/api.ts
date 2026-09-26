"use client";

import { BotanicalClient } from "@botanical/core";

/**
 * Browser client. Empty base URL so requests hit same-origin `/api`,
 * which Next rewrites to BOTANICAL_API_URL (cookies stay first-party).
 */
export const api = new BotanicalClient({ baseUrl: "" });
