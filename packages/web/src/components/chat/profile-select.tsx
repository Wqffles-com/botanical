"use client";

import type { ModelProfile } from "@botanical/core";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { profileIsAvailable, profileKind, profileLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  disabled,
  needed,
  id,
  compact,
}: {
  profiles: ModelProfile[];
  value: string | null;
  onChange: (profileId: string | null) => void;
  disabled?: boolean;
  needed?: boolean;
  id?: string;
  compact?: boolean;
}) {
  const selected = profiles.find((profile) => profile.id === value) ?? null;
  const unavailable = selected !== null && !profileIsAvailable(selected);
  const apiProfiles = profiles.filter((profile) => profileKind(profile) === "api");
  const cliProfiles = profiles.filter((profile) => profileKind(profile) === "cli");

  return (
    <div className={cn("min-w-0", compact ? "max-w-[280px]" : "w-full")}>
      <Select
        value={value}
        onValueChange={(next) => onChange(typeof next === "string" && next ? next : null)}
        disabled={disabled || profiles.length === 0}
      >
        <SelectTrigger
          id={id}
          data-testid="profile-select"
          aria-label="Model profile"
          className={cn(
            "max-w-full",
            compact ? "h-7 min-w-0" : "min-w-[220px]",
            (needed || unavailable) && "border-foreground/40",
          )}
          aria-invalid={needed || undefined}
        >
          <SelectValue placeholder="Select a model profile…">
            {(current: unknown) => {
              if (typeof current !== "string" || !current) return "Select a model profile…";
              return profiles.find((profile) => profile.id === current)?.name ?? current;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-[280px]" alignItemWithTrigger={false}>
          <ProfileGroup label="API" profiles={apiProfiles} />
          <ProfileGroup label="CLI (subscription)" profiles={cliProfiles} />
        </SelectContent>
      </Select>
      {unavailable && selected?.unavailableReason ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={selected.unavailableReason}>
          {selected.unavailableReason}
        </p>
      ) : null}
    </div>
  );
}

function ProfileGroup({ label, profiles }: { label: string; profiles: ModelProfile[] }) {
  if (profiles.length === 0) return null;
  return (
    <SelectGroup>
      <SelectLabel>{label}</SelectLabel>
      {profiles.map((profile) => {
        const available = profileIsAvailable(profile);
        return (
          <SelectItem
            key={profile.id}
            value={profile.id}
            disabled={!available}
            className={cn(!available && "data-disabled:opacity-100")}
          >
            <span className="flex min-w-0 flex-col items-start">
              <span className={cn("truncate", !available && "text-muted-foreground")}>{profile.name}</span>
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                {available ? profileLabel(profile).replace(`${profile.name} · `, "") : profile.unavailableReason || "Unavailable"}
              </span>
            </span>
          </SelectItem>
        );
      })}
    </SelectGroup>
  );
}
