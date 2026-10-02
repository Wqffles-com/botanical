import type { ModelPrice } from "@botanical/core";

/** `1.2K`, `3.4M`. Whole numbers below a thousand. */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Dollars with enough digits for a few cents of spend. `—` when the cost is unknown. */
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export interface PriceDraft {
  prefix: string;
  input: string;
  output: string;
}

export function draftsFromOverrides(overrides: Record<string, ModelPrice>): PriceDraft[] {
  return Object.entries(overrides).map(([prefix, price]) => ({
    prefix,
    input: String(price.inputPerMTok),
    output: String(price.outputPerMTok),
  }));
}

/** Parse the editor rows. Blank rows are skipped. Returns an error message when a row is unusable. */
export function overridesFromDrafts(
  drafts: readonly PriceDraft[],
): { overrides: Record<string, ModelPrice> } | { error: string } {
  const overrides: Record<string, ModelPrice> = {};
  for (const draft of drafts) {
    const prefix = draft.prefix.trim().toLowerCase();
    if (!prefix && !draft.input.trim() && !draft.output.trim()) continue;
    if (!prefix) return { error: "Every price needs a model name." };
    const inputPerMTok = Number(draft.input);
    const outputPerMTok = Number(draft.output);
    const valid = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100_000;
    if (draft.input.trim() === "" || draft.output.trim() === "" || !valid(inputPerMTok) || !valid(outputPerMTok)) {
      return { error: `Prices for ${prefix} must be numbers from 0 to 100000.` };
    }
    overrides[prefix] = { inputPerMTok, outputPerMTok };
  }
  return { overrides };
}
