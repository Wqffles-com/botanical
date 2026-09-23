/** Same codebase, two deploy modes. Default is self-host. */
export const DEPLOYMENT_MODES = ["self-host", "saas"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export interface HealthResponse {
  ok: true;
  service: "botanical";
  mode: DeploymentMode;
}

/** Unknown or empty values stay on self-host so a laptop boot never assumes SaaS. */
export function resolveDeploymentMode(raw: string | undefined): DeploymentMode {
  if (raw === "saas" || raw === "self-host") return raw;
  return "self-host";
}
