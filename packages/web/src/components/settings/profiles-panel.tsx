import type { ModelProfile } from "@botanical/core";
import { Badge } from "@botanical/ui/components/badge";
import { EmptyState } from "@/components/empty-state";
import { profileIsAvailable, profileKind } from "@/lib/format";
import { providerLabel } from "@/lib/format-extra";

export function ProfilesPanel({ profiles }: { profiles: ModelProfile[] }) {
  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No model profiles"
        body="The server lists API profiles whose provider key is set, plus any CLI profiles, including ones that are not available yet."
        className="min-h-40 rounded-xl border border-dashed"
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Profile</th>
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const available = profileIsAvailable(profile);
            const kind = profileKind(profile);
            return (
              <tr key={profile.id} className="border-t align-top">
                <td className="px-3 py-3">
                  <div className="font-medium">{profile.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{profile.id}</div>
                  {profile.description ? (
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">{profile.description}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-xs">
                  <div>{providerLabel(profile.provider)}</div>
                  <div className="font-mono text-muted-foreground">{profile.model}</div>
                </td>
                <td className="px-3 py-3">
                  <Badge variant="outline">{kind === "cli" ? "CLI" : "API"}</Badge>
                </td>
                <td className="px-3 py-3">
                  <Badge variant={available ? "secondary" : "outline"}>{available ? "Available" : "Unavailable"}</Badge>
                  {!available && profile.unavailableReason ? (
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">{profile.unavailableReason}</p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
