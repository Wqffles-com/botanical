import { DEPLOYMENT_MODES, type DeploymentMode } from './types.ts';

function canonicalize(value: string): DeploymentMode | null {
  const normalized = value.trim().toLowerCase().replaceAll('-', '_');
  if (normalized === 'selfhost') return 'self_host';
  if ((DEPLOYMENT_MODES as readonly string[]).includes(normalized)) {
    return normalized as DeploymentMode;
  }
  return null;
}

/** Map `self_host`, `saas`, `SELF_HOST`, or `SAAS` onto the stored mode. Throws on anything else. */
export function normalizeDeploymentMode(value: unknown): DeploymentMode {
  if (typeof value !== 'string') {
    throw new Error(
      `DEPLOYMENT_MODE must be self_host or saas, got ${JSON.stringify(value)}`,
    );
  }
  const mode = canonicalize(value);
  if (!mode) {
    throw new Error(
      `DEPLOYMENT_MODE must be self_host or saas, got ${JSON.stringify(value)}`,
    );
  }
  return mode;
}

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Resolve the process deployment mode.
 * A set env var wins. Otherwise the `settings.deployment.mode` value. Otherwise `self_host`.
 * Invalid values throw. Missing config never selects SaaS.
 */
export function resolveDeploymentMode(input?: {
  env?: unknown;
  setting?: unknown;
}): DeploymentMode {
  if (!isBlank(input?.env)) return normalizeDeploymentMode(input?.env);
  if (!isBlank(input?.setting)) return normalizeDeploymentMode(input?.setting);
  return 'self_host';
}
