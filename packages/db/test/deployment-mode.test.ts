import { describe, expect, test } from 'bun:test';

import { normalizeDeploymentMode, resolveDeploymentMode } from '../src/deployment-mode.ts';

describe('deployment mode', () => {
  test('normalizes self-host and saas spellings', () => {
    expect(normalizeDeploymentMode('self_host')).toBe('self_host');
    expect(normalizeDeploymentMode('SELF_HOST')).toBe('self_host');
    expect(normalizeDeploymentMode('self-host')).toBe('self_host');
    expect(normalizeDeploymentMode('saas')).toBe('saas');
    expect(normalizeDeploymentMode('SAAS')).toBe('saas');
  });

  test('rejects unknown modes', () => {
    expect(() => normalizeDeploymentMode('hosted')).toThrow(/self_host or saas/);
    expect(() => normalizeDeploymentMode(1)).toThrow(/self_host or saas/);
  });

  test('env wins, then the settings row, then self-host', () => {
    expect(resolveDeploymentMode({ env: 'SAAS', setting: 'self_host' })).toBe('saas');
    expect(resolveDeploymentMode({ env: '  ', setting: 'saas' })).toBe('saas');
    expect(resolveDeploymentMode({})).toBe('self_host');
    expect(resolveDeploymentMode()).toBe('self_host');
    expect(() => resolveDeploymentMode({ env: 'nope' })).toThrow(/self_host or saas/);
  });
});
