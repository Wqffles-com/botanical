const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  "openai-compat": "OpenAI-compatible",
  openai_compat: "OpenAI-compatible",
  custom: "Custom",
  mock: "Mock",
};

export function providerLabel(id: string): string {
  const key = id.trim().toLowerCase();
  return PROVIDER_LABELS[key] ?? id;
}
