import { Layers } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@botanical/ui/components/table";
import type { ModelProfile } from "@botanical/core";
import { Badge } from "@botanical/ui/components/badge";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { profileIsAvailable, profileKind } from "@/lib/format";
import { providerLabel } from "@/lib/format-extra";

export function ProfilesPanel({ profiles }: { profiles: ModelProfile[] }) {
  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No model profiles"
        body="The server lists API profiles whose provider key is set, plus any CLI profiles, including ones that are not available yet."
        bordered
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/60 text-xs">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-muted-foreground">Profile</TableHead>
            <TableHead className="px-3 text-muted-foreground">Provider</TableHead>
            <TableHead className="px-3 text-muted-foreground">Kind</TableHead>
            <TableHead className="px-3 text-muted-foreground">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((profile) => {
            const available = profileIsAvailable(profile);
            const kind = profileKind(profile);
            return (
              <TableRow key={profile.id} className="align-top">
                <TableCell className="px-3 py-3 align-top whitespace-normal">
                  <div className="font-medium">{profile.name}</div>
                  <div className="font-mono text-2xs text-muted-foreground">{profile.id}</div>
                  {profile.description ? (
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">{profile.description}</p>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal text-xs">
                  <div>{providerLabel(profile.provider)}</div>
                  <div className="font-mono text-muted-foreground">{profile.model}</div>
                </TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal">
                  <Badge variant="outline">{kind === "cli" ? "CLI" : "API"}</Badge>
                </TableCell>
                <TableCell className="px-3 py-3 align-top whitespace-normal">
                  <Badge variant={available ? "secondary" : "outline"}>{available ? "Available" : "Unavailable"}</Badge>
                  {!available && profile.unavailableReason ? (
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">{profile.unavailableReason}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
