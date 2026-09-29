"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@botanical/ui/components/select";
import { profileIsAvailable } from "@/lib/format";
import {
  groupProfilesByProvider,
  modelLabel,
  profileForProvider,
  providerKey,
  type PickableProfile,
  type ProviderGroup,
} from "@/lib/profile-groups";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/**
 * Two fields for one model profile: the provider (an API vendor or a coding
 * CLI) and the model it runs. The value is still the profile id.
 */
/** Composer chips: borderless pills that only fill on hover. */
const COMPACT_TRIGGER =
  "h-8 min-w-0 rounded-full border-transparent bg-transparent px-3 text-muted-foreground hover:bg-accent hover:text-foreground dark:bg-transparent dark:hover:bg-accent";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  disabled,
  needed,
  id,
  compact,
  noneLabel,
}: {
  profiles: PickableProfile[];
  value: string | null;
  onChange: (profileId: string | null) => void;
  disabled?: boolean;
  needed?: boolean;
  id?: string;
  compact?: boolean;
  /** When set, the provider list starts with this option, which clears the value. */
  noneLabel?: string;
}) {
  const groups = groupProfilesByProvider(profiles);
  const selected = profiles.find((profile) => profile.id === value) ?? null;
  // Remembers a provider picked before any of its models could be selected.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const groupKey = selected ? providerKey(selected) : pickedKey;
  const group = groups.find((item) => item.key === groupKey) ?? null;
  const unavailable = selected !== null && !profileIsAvailable(selected);
  const apiGroups = groups.filter((item) => item.kind === "api");
  const cliGroups = groups.filter((item) => item.kind === "cli");
  const off = disabled || profiles.length === 0;

  function pickProvider(next: unknown) {
    const key = typeof next === "string" && next && next !== NONE ? next : null;
    setPickedKey(key);
    const target = groups.find((item) => item.key === key);
    onChange(target ? (profileForProvider(target, value)?.id ?? null) : null);
  }

  return (
    <div className={cn("min-w-0", compact ? "max-w-[360px]" : "w-full")}>
      <div className={cn("flex min-w-0 gap-2", compact ? "items-center" : "flex-col sm:flex-row")}>
        <Select value={group?.key ?? (noneLabel ? NONE : null)} onValueChange={pickProvider} disabled={off}>
          <SelectTrigger
            id={id}
            data-testid="profile-select"
            aria-label="Provider"
            className={cn(
              "max-w-full",
              compact ? COMPACT_TRIGGER : "min-w-[180px] sm:flex-1",
              (needed || unavailable) && "border-foreground/40",
            )}
            aria-invalid={needed || undefined}
          >
            <SelectValue placeholder="Select a provider…">
              {(current: unknown) => {
                if (current === NONE && noneLabel) return noneLabel;
                return groups.find((item) => item.key === current)?.label ?? "Select a provider…";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-[220px]">
            {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
            <ProviderGroupList label="API" groups={apiGroups} />
            <ProviderGroupList label="CLI (subscription)" groups={cliGroups} />
          </SelectContent>
        </Select>
        <Select
          value={selected?.id ?? null}
          onValueChange={(next) => onChange(typeof next === "string" && next ? next : null)}
          disabled={off || !group}
        >
          <SelectTrigger
            data-testid="model-select"
            aria-label="Model"
            className={cn("max-w-full", compact ? COMPACT_TRIGGER : "min-w-[180px] sm:flex-1")}
          >
            <SelectValue placeholder="Model">
              {(current: unknown) => {
                const profile = group?.profiles.find((item) => item.id === current);
                return profile ? modelLabel(profile, group?.profiles) : "Model";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-[220px]">
            {group?.profiles.map((profile) => {
              const available = profileIsAvailable(profile);
              return (
                <SelectItem
                  key={profile.id}
                  value={profile.id}
                  disabled={!available}
                  className={cn(!available && "data-disabled:opacity-100")}
                >
                  <span className="flex min-w-0 flex-col items-start">
                    <span className={cn("truncate", !available && "text-muted-foreground")}>
                      {modelLabel(profile, group.profiles)}
                    </span>
                    {available ? null : (
                      <span className="truncate text-2xs font-normal text-muted-foreground">
                        {profile.unavailableReason || "Unavailable"}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      {unavailable && selected?.unavailableReason ? (
        <p className="mt-1 truncate text-2xs text-muted-foreground" title={selected.unavailableReason}>
          {selected.unavailableReason}
        </p>
      ) : null}
    </div>
  );
}

function ProviderGroupList({ label, groups }: { label: string; groups: ProviderGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <SelectGroup>
      <SelectLabel>{label}</SelectLabel>
      {groups.map((group) => (
        <SelectItem
          key={group.key}
          value={group.key}
          disabled={!group.available}
          className={cn(!group.available && "data-disabled:opacity-100")}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className={cn("truncate", !group.available && "text-muted-foreground")}>{group.label}</span>
            {group.available ? null : (
              <span className="truncate text-2xs font-normal text-muted-foreground">{group.unavailableReason}</span>
            )}
          </span>
        </SelectItem>
      ))}
    </SelectGroup>
  );
}
