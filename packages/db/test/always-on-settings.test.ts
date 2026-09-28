import { describe, expect, test } from 'bun:test';
import {
  ALWAYS_ON_DEFAULTS,
  AlwaysOnSettingsError,
  alwaysOnToRaw,
  applyAlwaysOnPatch,
  createAlwaysOnSettingsAccessor,
  normalizeAlwaysOn,
} from '../src/always-on-settings.ts';

describe('always-on settings', () => {
  test('absent keys use defaults and out-of-range numbers are clamped', () => {
    expect(normalizeAlwaysOn({})).toEqual({ ...ALWAYS_ON_DEFAULTS });
    expect(
      normalizeAlwaysOn({
        'always_on.scheduler_enabled': 'yes',
        'always_on.scheduler_interval_ms': 10,
        'always_on.background_concurrency': 100,
        'always_on.listener_max_bytes': 0,
      }),
    ).toEqual({
      schedulerEnabled: true,
      schedulerIntervalMs: 1_000,
      backgroundConcurrency: 32,
      listenerMaxBytes: 1,
    });
  });

  test('patches reject the wrong type and clamp numbers', () => {
    expect(() =>
      applyAlwaysOnPatch({ ...ALWAYS_ON_DEFAULTS }, { schedulerEnabled: 'no' as unknown as boolean }),
    ).toThrow(AlwaysOnSettingsError);
    expect(
      applyAlwaysOnPatch({ ...ALWAYS_ON_DEFAULTS }, {
        schedulerIntervalMs: 9_000_000,
        backgroundConcurrency: 0,
        listenerMaxBytes: 9_000_000,
      }),
    ).toEqual({
      schedulerEnabled: true,
      schedulerIntervalMs: 3_600_000,
      backgroundConcurrency: 1,
      listenerMaxBytes: 5_000_000,
    });
  });

  test('a write is visible to peek without waiting for the cache window', async () => {
    let raw: Record<string, unknown> = {};
    let now = 0;
    const settings = createAlwaysOnSettingsAccessor({
      read: async () => ({ ...raw }),
      write: async (value) => {
        raw = alwaysOnToRaw(value);
      },
      now: () => now,
    });
    expect(settings.peek().schedulerEnabled).toBe(true);
    await settings.update({ schedulerEnabled: false, schedulerIntervalMs: 2_000 });
    expect(settings.peek()).toMatchObject({ schedulerEnabled: false, schedulerIntervalMs: 2_000 });
    now = 60_000;
    expect(await settings.get()).toMatchObject({ schedulerEnabled: false, schedulerIntervalMs: 2_000 });
  });
});
