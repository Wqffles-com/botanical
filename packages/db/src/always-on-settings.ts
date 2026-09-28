/**
 * Instance settings for routines, listeners, and background turns.
 * Absent keys use the defaults. A short cache lets a change apply without a restart.
 * These rows are instance-admin settings: one value for the deployment until accounts land.
 */

export const ALWAYS_ON_CACHE_MS = 60_000;

export const ALWAYS_ON_SETTING_KEYS = {
  schedulerEnabled: 'always_on.scheduler_enabled',
  schedulerIntervalMs: 'always_on.scheduler_interval_ms',
  backgroundConcurrency: 'always_on.background_concurrency',
  listenerMaxBytes: 'always_on.listener_max_bytes',
} as const;

export const ALWAYS_ON_DEFAULTS = {
  schedulerEnabled: true,
  schedulerIntervalMs: 15_000,
  backgroundConcurrency: 2,
  listenerMaxBytes: 65_536,
} as const;

const INTERVAL = { min: 1_000, max: 3_600_000 };
const CONCURRENCY = { min: 1, max: 32 };
const LISTENER_BYTES = { min: 1, max: 5_000_000 };

export interface AlwaysOnSettings {
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  backgroundConcurrency: number;
  listenerMaxBytes: number;
}

export type AlwaysOnSettingsPatch = Partial<AlwaysOnSettings>;

export class AlwaysOnSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlwaysOnSettingsError';
  }
}

export interface AlwaysOnSettingsRepository {
  /** Last value read or written. Defaults until the first read. */
  peek(): AlwaysOnSettings;
  get(): Promise<AlwaysOnSettings>;
  update(patch: AlwaysOnSettingsPatch): Promise<AlwaysOnSettings>;
}

/** Read stored JSON, clamping numbers and ignoring values of the wrong type. */
export function normalizeAlwaysOn(raw: Record<string, unknown>): AlwaysOnSettings {
  return {
    schedulerEnabled: readBool(raw[ALWAYS_ON_SETTING_KEYS.schedulerEnabled], ALWAYS_ON_DEFAULTS.schedulerEnabled),
    schedulerIntervalMs: readInt(
      raw[ALWAYS_ON_SETTING_KEYS.schedulerIntervalMs],
      ALWAYS_ON_DEFAULTS.schedulerIntervalMs,
      INTERVAL,
    ),
    backgroundConcurrency: readInt(
      raw[ALWAYS_ON_SETTING_KEYS.backgroundConcurrency],
      ALWAYS_ON_DEFAULTS.backgroundConcurrency,
      CONCURRENCY,
    ),
    listenerMaxBytes: readInt(
      raw[ALWAYS_ON_SETTING_KEYS.listenerMaxBytes],
      ALWAYS_ON_DEFAULTS.listenerMaxBytes,
      LISTENER_BYTES,
    ),
  };
}

/** Merge a patch onto the current value. Wrong types throw. Numbers are clamped into range. */
export function applyAlwaysOnPatch(current: AlwaysOnSettings, patch: AlwaysOnSettingsPatch): AlwaysOnSettings {
  const next: AlwaysOnSettings = { ...current };
  if (patch.schedulerEnabled !== undefined) {
    if (typeof patch.schedulerEnabled !== 'boolean') {
      throw new AlwaysOnSettingsError('schedulerEnabled must be a boolean');
    }
    next.schedulerEnabled = patch.schedulerEnabled;
  }
  if (patch.schedulerIntervalMs !== undefined) {
    next.schedulerIntervalMs = requireInt(patch.schedulerIntervalMs, 'schedulerIntervalMs', INTERVAL);
  }
  if (patch.backgroundConcurrency !== undefined) {
    next.backgroundConcurrency = requireInt(patch.backgroundConcurrency, 'backgroundConcurrency', CONCURRENCY);
  }
  if (patch.listenerMaxBytes !== undefined) {
    next.listenerMaxBytes = requireInt(patch.listenerMaxBytes, 'listenerMaxBytes', LISTENER_BYTES);
  }
  return next;
}

export function alwaysOnToRaw(value: AlwaysOnSettings): Record<string, unknown> {
  return {
    [ALWAYS_ON_SETTING_KEYS.schedulerEnabled]: value.schedulerEnabled,
    [ALWAYS_ON_SETTING_KEYS.schedulerIntervalMs]: value.schedulerIntervalMs,
    [ALWAYS_ON_SETTING_KEYS.backgroundConcurrency]: value.backgroundConcurrency,
    [ALWAYS_ON_SETTING_KEYS.listenerMaxBytes]: value.listenerMaxBytes,
  };
}

export function createAlwaysOnSettingsAccessor(io: {
  read(): Promise<Record<string, unknown>>;
  write(value: AlwaysOnSettings): Promise<void>;
  now?: () => number;
}): AlwaysOnSettingsRepository {
  let cached: { at: number; value: AlwaysOnSettings } | null = null;
  const now = () => io.now?.() ?? Date.now();

  return {
    peek() {
      return cached?.value ?? { ...ALWAYS_ON_DEFAULTS };
    },
    async get() {
      const stamp = now();
      if (cached && stamp - cached.at < ALWAYS_ON_CACHE_MS) return cached.value;
      const value = normalizeAlwaysOn(await io.read());
      cached = { at: stamp, value };
      return value;
    },
    async update(patch) {
      const current = normalizeAlwaysOn(await io.read());
      const value = applyAlwaysOnPatch(current, patch);
      await io.write(value);
      cached = { at: now(), value };
      return value;
    },
  };
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readInt(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, range);
}

function requireInt(value: unknown, name: string, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AlwaysOnSettingsError(`${name} must be a number`);
  }
  return clamp(value, range);
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}
