import type { ModelCapabilities, ProviderType } from "./types.ts";

/**
 * Baseline capability hints. Numbers are policy hints, not a catalog.
 * Override a model via `ProviderConfig.capabilities`.
 */
export const DEFAULT_CAPABILITIES: Record<ProviderType, ModelCapabilities> = {
  openai: {
    tools: true,
    parallelTools: true,
    vision: true,
    maxContext: 128_000,
    streaming: true,
    reasoning: false,
  },
  anthropic: {
    tools: true,
    parallelTools: true,
    vision: true,
    maxContext: 200_000,
    streaming: true,
    reasoning: false,
  },
  xai: {
    tools: true,
    parallelTools: true,
    vision: true,
    maxContext: 131_072,
    streaming: true,
    reasoning: false,
  },
  deepseek: {
    tools: true,
    parallelTools: false,
    vision: false,
    maxContext: 128_000,
    streaming: true,
    reasoning: false,
  },
  openrouter: {
    tools: true,
    parallelTools: true,
    vision: false,
    maxContext: 128_000,
    streaming: true,
    reasoning: false,
  },
  "openai-compat": {
    tools: true,
    parallelTools: true,
    vision: false,
    maxContext: 32_768,
    streaming: true,
    reasoning: false,
  },
  mock: {
    tools: true,
    parallelTools: true,
    vision: false,
    maxContext: 8_192,
    streaming: true,
    reasoning: false,
  },
};

export function capabilitiesFor(
  type: ProviderType,
  model: string,
  overrides?: Record<string, Partial<ModelCapabilities>>,
): ModelCapabilities {
  const base = refine(type, model, { ...DEFAULT_CAPABILITIES[type] });
  const extra = overrides?.[model];
  return extra ? { ...base, ...extra } : base;
}

function refine(type: ProviderType, model: string, caps: ModelCapabilities): ModelCapabilities {
  const id = model.toLowerCase();
  const reasoning =
    id.includes("reason") ||
    /^o\d/.test(id) ||
    id.includes("thinking") ||
    (type === "deepseek" && id.includes("reasoner"));
  if (reasoning) {
    caps.reasoning = true;
    caps.parallelTools = false;
  }
  if (type === "deepseek" && !id.includes("vision")) caps.vision = false;
  if (type === "xai" && !id.includes("vision") && !id.includes("grok-4") && !id.includes("grok-2")) {
    caps.vision = false;
  }
  if (id.includes("vision")) caps.vision = true;
  return caps;
}
