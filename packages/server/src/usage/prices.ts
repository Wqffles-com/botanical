/** USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Prefs key (global) holding the admin's overrides: `{ [modelPrefix]: ModelPrice }`. */
export const PRICE_OVERRIDES_PREF = "usage.prices";

/**
 * Rough list prices by model id prefix. These are estimates, not billing: vendors change prices and
 * discount cached input. A model with no matching prefix is unpriced until an admin adds one.
 */
export const DEFAULT_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus": { inputPerMTok: 5, outputPerMTok: 25 },
};

const MAX_ENTRIES = 200;

export function isModelPrice(value: unknown): value is ModelPrice {
  if (typeof value !== "object" || value === null) return false;
  const { inputPerMTok, outputPerMTok } = value as Record<string, unknown>;
  return isRate(inputPerMTok) && isRate(outputPerMTok);
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000;
}

/** Keep only well-formed entries from a stored or submitted override map. Keys are lower-cased model prefixes. */
export function parsePriceOverrides(value: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [key, price] of Object.entries(value)) {
    const prefix = key.trim().toLowerCase();
    if (!prefix || prefix.length > 120 || !isModelPrice(price)) continue;
    out[prefix] = { inputPerMTok: price.inputPerMTok, outputPerMTok: price.outputPerMTok };
    if (Object.keys(out).length >= MAX_ENTRIES) break;
  }
  return out;
}

/** The price whose prefix is the longest match for `model`. Overrides win over defaults on the same prefix. */
export function priceFor(model: string, overrides: Readonly<Record<string, ModelPrice>> = {}): ModelPrice | null {
  const id = model.trim().toLowerCase();
  const table = { ...DEFAULT_PRICES, ...overrides };
  let best: string | null = null;
  for (const prefix of Object.keys(table)) {
    if (id.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix;
  }
  return best === null ? null : (table[best] as ModelPrice);
}

export function estimateCostUsd(inputTokens: number, outputTokens: number, price: ModelPrice | null): number | null {
  if (!price) return null;
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}
