import { Badge } from "@botanical/ui/components/badge";

export function RoleBadges({
  roles,
}: {
  roles: Array<{ id: string; name: string; builtin?: boolean }>;
}) {
  if (roles.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role.id || role.name} variant="outline" className="h-4 px-1.5 text-2xs font-normal">
          {role.name}
        </Badge>
      ))}
    </span>
  );
}
