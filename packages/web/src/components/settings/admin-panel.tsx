"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";

const PROVIDERS = [
  { name: "deepseek", label: "DeepSeek", model: "deepseek-chat" },
  { name: "openai", label: "OpenAI", model: "gpt-4.1" },
  { name: "anthropic", label: "Anthropic", model: "claude-sonnet-4-5" },
  { name: "xai", label: "xAI", model: "grok-4" },
  { name: "openrouter", label: "OpenRouter", model: "openai/gpt-4.1" },
] as const;

type SecretMeta = { name: string; last4: string };
type SignupMode = "open" | "invite" | "closed";

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

  async function load() {
    const response = await request("/api/admin/settings");
    const body = (await response.json()) as {
      signupMode: SignupMode;
      allowGlobalKeys: boolean;
      secrets: SecretMeta[];
    };
    setSignupMode(body.signupMode);
    setAllowGlobalKeys(body.allowGlobalKeys);
    setSecrets(body.secrets);
  }

  useEffect(() => {
    void load().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not load admin settings");
    });
  }, []);

  async function savePolicy() {
    await request("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ signupMode, allowGlobalKeys }),
    });
    toast.success("Saved");
  }

  async function saveKey(name: string, model: string) {
    const value = drafts[name]?.trim() ?? "";
    if (!value) return;
    await request(`/api/admin/secrets/${name}`, { method: "PUT", body: JSON.stringify({ value }) });
    await request("/api/admin/profiles", {
      method: "POST",
      body: JSON.stringify({
        id: name,
        name: PROVIDERS.find((item) => item.name === name)?.label ?? name,
        provider: name,
        model,
      }),
    });
    setDrafts((current) => ({ ...current, [name]: "" }));
    await load();
    toast.success("Key saved");
  }

  async function createInvite() {
    const response = await request("/api/admin/invites", { method: "POST", body: JSON.stringify({ days: 7 }) });
    const body = (await response.json()) as { url: string };
    setInviteUrl(body.url);
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
            <input
              type="checkbox"
              data-testid="allow-global-keys"
              checked={allowGlobalKeys}
              onChange={(event) => setAllowGlobalKeys(event.target.checked)}
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
                <Button type="button" data-testid={`save-secret-${provider.name}`} onClick={() => void saveKey(provider.name, provider.model)}>
                  Save key
                </Button>
              </div>
            );
          })}
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
