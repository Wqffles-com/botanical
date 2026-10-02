"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { Checkbox } from "@botanical/ui/components/checkbox";
import { Label } from "@botanical/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";

const PROVIDERS = [
  { name: "deepseek", label: "DeepSeek" },
  { name: "openai", label: "OpenAI" },
  { name: "anthropic", label: "Anthropic" },
  { name: "xai", label: "xAI" },
  { name: "openrouter", label: "OpenRouter" },
] as const;

type SecretMeta = { name: string; last4: string };
type GlobalProfile = { id: string; name: string; provider: string; model: string; kind?: string };
type SignupMode = "open" | "invite" | "closed";
type AdminUser = { id: string; email: string; displayName: string; role: string };

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok && response.status !== 204) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return response;
}

const SIGNUP_MODES = [
  { value: "open", label: "Open" },
  { value: "invite", label: "Invite only" },
  { value: "closed", label: "Closed" },
];

export function AdminPanel() {
  const [signupMode, setSignupMode] = useState<SignupMode>("open");
  const [allowGlobalKeys, setAllowGlobalKeys] = useState(true);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [resetUrl, setResetUrl] = useState<{ userId: string; url: string } | null>(null);
  const [profiles, setProfiles] = useState<GlobalProfile[]>([]);
  const [knownModels, setKnownModels] = useState<Record<string, string[]>>({});

  async function fetchAdmin() {
    const [settingsResponse, profilesResponse] = await Promise.all([
      request("/api/admin/settings"),
      request("/api/admin/profiles"),
    ]);
    const body = (await settingsResponse.json()) as {
      signupMode: SignupMode;
      allowGlobalKeys: boolean;
      secrets: SecretMeta[];
    };
    const listed = (await profilesResponse.json()) as {
      profiles: GlobalProfile[];
      knownModels?: Record<string, string[]>;
    };
    return { body, listed };
  }

  function applyAdmin({ body, listed }: Awaited<ReturnType<typeof fetchAdmin>>) {
    setSignupMode(body.signupMode);
    setAllowGlobalKeys(body.allowGlobalKeys);
    setSecrets(body.secrets);
    setProfiles(listed.profiles);
    setKnownModels(listed.knownModels ?? {});
  }

  async function load() {
    applyAdmin(await fetchAdmin());
  }

  useEffect(() => {
    void fetchAdmin()
      .then(applyAdmin)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Could not load admin settings");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function savePolicy() {
    await request("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ signupMode, allowGlobalKeys }),
    });
    toast.success("Saved");
  }

  async function saveKey(name: string) {
    const value = drafts[name]?.trim() ?? "";
    if (!value) return;
    await request(`/api/admin/secrets/${name}`, { method: "PUT", body: JSON.stringify({ value }) });
    // A provider with no models yet gets every known one, so the picker has a choice.
    if (!profiles.some((profile) => profile.provider === name)) {
      const added = [...profiles];
      for (const model of knownModels[name] ?? []) {
        added.push(await postModel(name, model, added));
      }
    }
    setDrafts((current) => ({ ...current, [name]: "" }));
    await load();
    toast.success("Key saved");
  }

  async function addModel(provider: string, model: string) {
    await postModel(provider, model, profiles);
    await load();
    toast.success(`${model} added`);
  }

  async function removeModel(id: string) {
    await request(`/api/admin/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
    toast.success("Model removed");
  }

  async function createInvite() {
    const response = await request("/api/admin/invites", { method: "POST", body: JSON.stringify({ days: 7 }) });
    const body = (await response.json()) as { url: string };
    setInviteUrl(body.url);
  }

  useEffect(() => {
    request("/api/admin/users")
      .then((response) => response.json())
      .then((body: { users: AdminUser[] }) => setUsers(body.users))
      .catch(() => undefined);
  }, []);

  async function createResetLink(userId: string) {
    try {
      const response = await request(`/api/admin/users/${encodeURIComponent(userId)}/reset-link`, {
        method: "POST",
        body: JSON.stringify({ hours: 24 }),
      });
      const body = (await response.json()) as { url: string };
      setResetUrl({ userId, url: body.url });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the reset link");
    }
  }

  return (
    <div className="space-y-4" data-testid="admin-panel">
      <Card>
        <CardHeader>
          <CardTitle>Signup</CardTitle>
          <CardDescription>Open, invite-only, or closed. The first account is always allowed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="signup-mode">Mode</Label>
            <Select
              items={SIGNUP_MODES}
              value={signupMode}
              onValueChange={(next) => {
                if (next) setSignupMode(next as SignupMode);
              }}
            >
              <SelectTrigger id="signup-mode" data-testid="signup-mode" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIGNUP_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              data-testid="allow-global-keys"
              checked={allowGlobalKeys}
              onCheckedChange={(next) => setAllowGlobalKeys(next)}
            />
            Members may use global provider keys
          </label>
          <Button type="button" data-testid="save-admin-policy" onClick={() => void savePolicy()}>
            Save
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Global provider keys</CardTitle>
          <CardDescription>Write-only. The server stores them encrypted and shows the last 4 characters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PROVIDERS.map((provider) => {
            const saved = secrets.find((item) => item.name === provider.name);
            return (
              <div key={provider.name} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                <div>
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="text-xs text-muted-foreground" data-testid={`secret-last4-${provider.name}`}>
                    {saved ? `••••${saved.last4}` : "Not set"}
                  </p>
                </div>
                <Input
                  type="password"
                  data-testid={`secret-${provider.name}`}
                  autoComplete="off"
                  placeholder="Paste a key"
                  value={drafts[provider.name] ?? ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [provider.name]: event.target.value }))}
                />
                <Button type="button" data-testid={`save-secret-${provider.name}`} onClick={() => void saveKey(provider.name)}>
                  Save key
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            The models everyone can pick for each provider. Choose a current model or type any model id the provider serves.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROVIDERS.map((provider) => (
            <ProviderModels
              key={provider.name}
              provider={provider.name}
              label={provider.label}
              profiles={profiles.filter((profile) => profile.provider === provider.name && profile.kind !== "cli")}
              known={knownModels[provider.name] ?? []}
              onAdd={(model) =>
                addModel(provider.name, model).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : "Could not add the model");
                })
              }
              onRemove={(id) =>
                removeModel(id).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : "Could not remove the model");
                })
              }
            />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password resets</CardTitle>
          <CardDescription>
            Create a one-time reset link for a user who forgot their password. It is valid for 24 hours and signs
            them out everywhere. Send it to them yourself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="reset-users">
          {users.map((user) => (
            <div key={user.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {user.displayName} <span className="text-muted-foreground">{user.email}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`reset-link-${user.email}`}
                  onClick={() => void createResetLink(user.id)}
                >
                  Reset link
                </Button>
              </div>
              {resetUrl?.userId === user.id ? (
                <p className="break-all font-mono text-xs" data-testid="reset-url">
                  {resetUrl.url}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
          <CardDescription>One link, one signup, valid for 7 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button type="button" variant="outline" data-testid="create-invite" onClick={() => void createInvite()}>
            Create invite link
          </Button>
          {inviteUrl ? (
            <p className="break-all font-mono text-xs" data-testid="invite-url">
              {inviteUrl}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

const CUSTOM_MODEL = "__custom__";

/** The provider's first model takes the provider id; later ones are `<provider>--<model>`. */
async function postModel(provider: string, model: string, existing: readonly GlobalProfile[]): Promise<GlobalProfile> {
  const label = PROVIDERS.find((item) => item.name === provider)?.label ?? provider;
  const first = !existing.some((profile) => profile.id === provider || profile.provider === provider);
  const profile = {
    id: first ? provider : modelProfileId(provider, model),
    name: first ? label : `${label} (${model})`,
    provider,
    model,
  };
  await request("/api/admin/profiles", { method: "POST", body: JSON.stringify(profile) });
  return profile;
}

/** Same shape as the server's built-in sibling ids (`modelProfileId` in @botanical/providers). */
function modelProfileId(provider: string, model: string): string {
  return `${provider}--${model.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 64);
}

function ProviderModels({
  provider,
  label,
  profiles,
  known,
  onAdd,
  onRemove,
}: {
  provider: string;
  label: string;
  profiles: GlobalProfile[];
  known: string[];
  onAdd: (model: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const listed = new Set(profiles.map((profile) => profile.model));
  const choices = [
    ...known.filter((model) => !listed.has(model)).map((model) => ({ value: model, label: model })),
    { value: CUSTOM_MODEL, label: "Custom model…" },
  ];
  const [choice, setChoice] = useState<string>(choices[0]?.value ?? CUSTOM_MODEL);
  const [custom, setCustom] = useState("");
  const selected = choices.some((item) => item.value === choice) ? choice : (choices[0]?.value ?? CUSTOM_MODEL);
  const model = selected === CUSTOM_MODEL ? custom.trim() : selected;

  async function add() {
    if (!model) return;
    await onAdd(model);
    setCustom("");
  }

  return (
    <div className="space-y-2" data-testid={`models-${provider}`}>
      <p className="text-sm font-medium">{label}</p>
      {profiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">No models yet.</p>
      ) : (
        <ul className="space-y-1">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-mono text-xs">{profile.model}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`remove-model-${profile.id}`}
                onClick={() => void onRemove(profile.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          items={choices}
          value={selected}
          onValueChange={(next) => {
            if (next) setChoice(next as string);
          }}
        >
          <SelectTrigger data-testid={`model-choice-${provider}`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected === CUSTOM_MODEL ? (
          <Input
            className="w-56"
            data-testid={`custom-model-${provider}`}
            placeholder="Model id"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          data-testid={`add-model-${provider}`}
          disabled={!model}
          onClick={() => void add()}
        >
          Add model
        </Button>
      </div>
    </div>
  );
}
