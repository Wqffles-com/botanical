import type { ModelProfile } from "@botanical/core";

export function ProfileSelect({
  id,
  profiles,
  value,
  onChange,
}: {
  id: string;
  profiles: ModelProfile[];
  value: string | null;
  onChange: (profileId: string | null) => void;
}) {
  return (
    <label className={value ? "bc-field bc-profile" : "bc-field bc-profile bc-profile--needed"} htmlFor={id}>
      <span>Model profile</span>
      <select
        id={id}
        data-testid="profile-select"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Select a model profile…</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profileLabel(profile)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function profileLabel(profile: ModelProfile): string {
  const detail = [profile.provider, profile.model].filter(Boolean).join(" / ");
  return detail ? `${profile.name} · ${detail}` : profile.name;
}
