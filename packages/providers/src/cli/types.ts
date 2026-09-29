export const CLI_NAMES = ["grok", "claude", "codex"] as const;
export type CliName = (typeof CLI_NAMES)[number];

export const CLI_PROFILE_PRESET_IDS = ["grok-build", "claude-code", "codex"] as const;
export type CliProfilePresetId = (typeof CLI_PROFILE_PRESET_IDS)[number];

/**
 * Models the picker offers for a CLI profile that sets no `model` or `models`.
 * Each becomes a sibling profile `<id>--<model>` that passes the model flag.
 */
export const CLI_KNOWN_MODELS: Record<CliName, readonly string[]> = {
  claude: ["opus", "sonnet", "haiku"],
  grok: ["grok-4.7", "grok-code-fast-1"],
  codex: ["gpt-5-codex", "gpt-5"],
};

/** Default headless turn budget. Profiles may override with `timeoutMs`. */
export const DEFAULT_CLI_TIMEOUT_MS = 600_000;

export interface CliProfileSpec {
  id: string;
  cli: CliName;
  label: string;
  description: string | null;
  /** Passed as a model flag only when set. There is no silent model default. */
  model?: string;
  /** Extra models to list as sibling profiles. Omitted uses `CLI_KNOWN_MODELS`; `[]` lists none. */
  models?: string[];
  /** Absolute path. When omitted, the CLI name is resolved on PATH. */
  bin?: string;
  timeoutMs: number;
  /**
   * When false, this run does not expose Botanical tools over MCP.
   * Omitted and true both expose them. `BOTANICAL_CLI_PROFILES` presets default to true.
   */
  botanicalTools: boolean;
}

export interface CliAvailability {
  available: boolean;
  unavailableReason?: string;
  bin?: string;
}
