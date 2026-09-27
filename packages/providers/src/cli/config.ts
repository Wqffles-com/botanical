import { ProviderError } from "../errors.ts";
import {
  CLI_NAMES,
  CLI_PROFILE_PRESET_IDS,
  DEFAULT_CLI_TIMEOUT_MS,
  type CliName,
  type CliProfilePresetId,
  type CliProfileSpec,
} from "./types.ts";

const PRESET_LABELS: Record<CliProfilePresetId, { cli: CliName; label: string; description: string }> = {
  "grok-build": {
    cli: "grok",
    label: "Grok Build",
    description:
      "Grok Build headless. Botanical tools and your MCP servers are exposed on a per-run loopback MCP server named botanical.",
  },
  "claude-code": {
    cli: "claude",
    label: "Claude Code",
    description:
      "Claude Code headless. Botanical tools and your MCP servers are exposed on a per-run loopback MCP server named botanical.",
  },
  codex: {
    cli: "codex",
    label: "Codex",
    description:
      "Codex headless. Botanical tools and your MCP servers are exposed on a per-run loopback MCP server named botanical.",
  },
};

/**
 * Pull `kind: "cli"` entries out of a profiles document before the API parser
 * sees them. CLI profiles do not need a provider API key and are not a default.
 */
export function splitProfileDocument(value: unknown): { api: unknown; cli: CliProfileSpec[] } {
  if (Array.isArray(value)) {
    return splitArray(value);
  }
  if (!value || typeof value !== "object") return { api: value, cli: [] };
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.profiles)) return { api: value, cli: [] };
  const split = splitArray(record.profiles);
  return { api: { ...record, profiles: split.api }, cli: split.cli };
}

/**
 * `BOTANICAL_CLI_PROFILES=grok-build,claude-code,codex` adds the preset ids.
 * Custom bins, models, and timeouts belong in `BOTANICAL_PROFILES`.
 */
export function parseCliProfileShortcut(value: string | undefined): CliProfileSpec[] {
  const text = value?.trim() ?? "";
  if (!text) return [];
  const specs: CliProfileSpec[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!(CLI_PROFILE_PRESET_IDS as readonly string[]).includes(id)) {
      throw new ProviderError(
        `BOTANICAL_CLI_PROFILES id ${JSON.stringify(id)} is unknown. Use ${CLI_PROFILE_PRESET_IDS.join(", ")}.`,
        { code: "config" },
      );
    }
    if (seen.has(id)) continue;
    seen.add(id);
    specs.push(presetSpec(id as CliProfilePresetId));
  }
  return specs;
}

/** Explicit profiles win. Shortcut entries fill ids that were not already declared. */
export function mergeCliProfiles(explicit: readonly CliProfileSpec[], shortcut: readonly CliProfileSpec[]): CliProfileSpec[] {
  const ids = new Set(explicit.map((spec) => spec.id));
  const merged = [...explicit];
  for (const spec of shortcut) {
    if (ids.has(spec.id)) continue;
    ids.add(spec.id);
    merged.push(spec);
  }
  return merged;
}

function splitArray(entries: readonly unknown[]): { api: unknown[]; cli: CliProfileSpec[] } {
  const api: unknown[] = [];
  const cli: CliProfileSpec[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (isCliEntry(entry)) {
      const spec = parseCliEntry(entry, index);
      if (seen.has(spec.id)) {
        throw new ProviderError(`Duplicate CLI profile id ${JSON.stringify(spec.id)}.`, { code: "config" });
      }
      seen.add(spec.id);
      cli.push(spec);
      return;
    }
    api.push(entry);
  });
  return { api, cli };
}

function isCliEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "cli" || record.provider === "cli";
}

function parseCliEntry(value: Record<string, unknown>, index: number): CliProfileSpec {
  const label = `BOTANICAL_PROFILES[${index}]`;
  for (const key of ["apiKey", "api_key", "token", "authorization", "password"]) {
    if (key in value) {
      throw new ProviderError(`${label} must not contain ${key}.`, { code: "config" });
    }
  }
  const id = requireId(value.id, `${label}.id`);
  const cli = requireCli(value.cli, `${label}.cli`);
  const nameSource = typeof value.label === "string" ? value.label : value.name;
  const title =
    typeof nameSource === "string" && nameSource.trim() !== ""
      ? nameSource.trim().slice(0, 120)
      : PRESET_LABELS[id as CliProfilePresetId]?.label ?? cli;
  const model = optionalText(value.model, `${label}.model`);
  const bin = optionalText(value.bin, `${label}.bin`);
  if (bin && !bin.startsWith("/")) {
    throw new ProviderError(`${label}.bin must be an absolute path.`, { code: "config" });
  }
  const description = optionalText(value.description, `${label}.description`);
  const botanicalTools = readBotanicalTools(value.botanicalTools, label);
  return {
    id,
    cli,
    label: title,
    description:
      description ??
      (botanicalTools
        ? `Subscription CLI (${cli}). Botanical tools are exposed on a per-run MCP server named botanical.`
        : `Subscription CLI (${cli}). Botanical tools are off for this profile; the CLI runs its own tools.`),
    ...(model ? { model } : {}),
    ...(bin ? { bin } : {}),
    timeoutMs: readTimeout(value.timeoutMs, label),
    botanicalTools,
  };
}

function presetSpec(id: CliProfilePresetId): CliProfileSpec {
  const preset = PRESET_LABELS[id];
  return {
    id,
    cli: preset.cli,
    label: preset.label,
    description: preset.description,
    timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
    botanicalTools: true,
  };
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProviderError(`${label} is required.`, { code: "config" });
  }
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new ProviderError(`${label} must be 1-64 characters of letters, numbers, "_" or "-".`, { code: "config" });
  }
  return id;
}

function requireCli(value: unknown, label: string): CliName {
  if (typeof value !== "string" || !(CLI_NAMES as readonly string[]).includes(value)) {
    throw new ProviderError(`${label} must be one of ${CLI_NAMES.join(", ")}.`, { code: "config" });
  }
  return value as CliName;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ProviderError(`${label} must be a string.`, { code: "config" });
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function readBotanicalTools(value: unknown, label: string): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "boolean") {
    throw new ProviderError(`${label}.botanicalTools must be a boolean.`, { code: "config" });
  }
  return value;
}

function readTimeout(value: unknown, label: string): number {
  if (value === undefined || value === null || value === "") return DEFAULT_CLI_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1_000 || value > 1_800_000) {
    throw new ProviderError(`${label}.timeoutMs must be an integer from 1000 to 1800000.`, { code: "config" });
  }
  return value;
}
