"use client";

import type { ModelProfile } from "@botanical/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { profileLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  disabled,
  needed,
  id,
}: {
  profiles: ModelProfile[];
  value: string | null;
  onChange: (profileId: string | null) => void;
  disabled?: boolean;
  needed?: boolean;
  id?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(typeof next === "string" && next ? next : null)}
      disabled={disabled || profiles.length === 0}
    >
      <SelectTrigger
        id={id}
        data-testid="profile-select"
        className={cn("min-w-[220px] max-w-full", needed && "border-destructive/60 ring-3 ring-destructive/20")}
        aria-invalid={needed || undefined}
      >
        <SelectValue placeholder="Select a model profile…" />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profileLabel(profile)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
