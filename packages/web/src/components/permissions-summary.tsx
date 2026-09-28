import type { EffectivePermissions } from "@botanical/core";
import { Badge } from "@botanical/ui/components/badge";
import { capabilityLabel, formatMcpGrant } from "@/lib/permissions";

export function PermissionsSummary({ permissions }: { permissions: EffectivePermissions }) {
  if (permissions.unrestricted) {
    return (
      <p className="text-sm text-muted-foreground">No roles — limited only by tool allowlist</p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {permissions.capabilities.length === 0 ? (
          <span className="text-sm text-muted-foreground">No capabilities</span>
        ) : (
          permissions.capabilities.map((capability) => (
            <Badge key={capability} variant="outline">
              {capabilityLabel(capability)}
            </Badge>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        MCP: {permissions.mcp.length > 0 ? permissions.mcp.map(formatMcpGrant).join("; ") : "none"}
      </p>
      {permissions.roleNames.length > 0 ? (
        <p className="text-xs text-muted-foreground">Roles: {permissions.roleNames.join(", ")}</p>
      ) : null}
    </div>
  );
}
