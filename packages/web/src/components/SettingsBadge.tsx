import type { DeploymentMode } from "@botanical/core";

export function SettingsBadge({ mode }: { mode: DeploymentMode }) {
  const label = mode === "SAAS" ? "Hosted" : "Self-host";
  return (
    <span className="bc-badge" data-testid="mode-badge" title="Deployment mode">
      {label}
    </span>
  );
}
