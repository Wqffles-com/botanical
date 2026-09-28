"use client";

import type { Agent, Listener, ListenerDelivery, ModelProfile } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@botanical/ui/components/badge";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@botanical/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@botanical/ui/components/dialog";
import { Input } from "@botanical/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { Switch } from "@botanical/ui/components/switch";
import { Textarea } from "@botanical/ui/components/textarea";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { formatWhen } from "@/lib/schedule";

interface Draft {
  id?: string;
  agentId: string;
  name: string;
  profileId: string;
  promptTemplate: string;
  enabled: boolean;
}

interface Revealed {
  url: string;
  secret: string;
}

const EMPTY: Draft = { agentId: "", name: "", profileId: "", promptTemplate: "", enabled: true };

export function ListenersView() {
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<ListenerDelivery[]>([]);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  async function refresh() {
    const [nextListeners, nextAgents, nextProfiles] = await Promise.all([
      api.listListeners(),
      api.listAgents(),
      api.listProfiles(),
    ]);
    setListeners(nextListeners);
    setAgents(nextAgents);
    setProfiles(nextProfiles);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
        if (!cancelled) setError(null);
      } catch (err) {
        if (cancelled || isUnauthorized(err)) return;
        setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!editor) return;
    if (!editor.agentId || !editor.profileId || !editor.name.trim()) {
      toast.error("Agent, name, and profile are required.");
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await api.updateListener(editor.id, {
          name: editor.name.trim(),
          profileId: editor.profileId,
          promptTemplate: editor.promptTemplate,
          enabled: editor.enabled,
        });
        setEditor(null);
      } else {
        const created = await api.createListener({
          agentId: editor.agentId,
          name: editor.name.trim(),
          profileId: editor.profileId,
          promptTemplate: editor.promptTemplate,
          enabled: editor.enabled,
        });
        setEditor(null);
        setRevealed({ url: created.url, secret: created.secret });
      }
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(listener: Listener, enabled: boolean) {
    try {
      const next = await api.updateListener(listener.id, { enabled });
      setListeners((current) => current.map((item) => (item.id === next.id ? next : item)));
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function rotate(listener: Listener) {
    try {
      const next = await api.rotateListenerSecret(listener.id);
      setRevealed(next);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function loadDeliveries(id: string) {
    setHistoryId(id);
    setDeliveryError(null);
    try {
      setDeliveries(await api.listListenerDeliveries(id));
    } catch (err) {
      setDeliveries([]);
      setDeliveryError(errorText(err));
    }
  }

  async function remove() {
    if (!removeId) return;
    try {
      await api.deleteListener(removeId);
      setRemoveId(null);
      if (historyId === removeId) setHistoryId(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const agentName = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Listeners"
        description="Inbound webhooks start a new chat for the agent. The payload is untrusted data, not instructions."
        actions={<Button onClick={() => setEditor({ ...EMPTY })}>New listener</Button>}
      />
      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {revealed ? <SecretCard revealed={revealed} onClose={() => setRevealed(null)} /> : null}
      <div className="mt-6 space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : listeners.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No listeners yet. A webhook URL is created with a secret that is shown once.
            </CardContent>
          </Card>
        ) : (
          listeners.map((listener) => (
            <Card key={listener.id}>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="truncate">{listener.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {agentName.get(listener.agentId) ?? "Unknown agent"} · {listener.kind}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{listener.enabled ? "On" : "Off"}</span>
                  <Switch
                    checked={listener.enabled}
                    aria-label={`${listener.enabled ? "Disable" : "Enable"} ${listener.name}`}
                    onCheckedChange={(checked) => void toggle(listener, checked === true)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="truncate font-mono text-xs text-muted-foreground">{listener.url}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyText(listener.url)}>
                    Copy URL
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void rotate(listener)}>
                    Rotate secret
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void loadDeliveries(listener.id)}>
                    Deliveries
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditor({
                        id: listener.id,
                        agentId: listener.agentId,
                        name: listener.name,
                        profileId: listener.profileId,
                        promptTemplate: listener.promptTemplate,
                        enabled: listener.enabled,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoveId(listener.id)}>
                    Delete
                  </Button>
                </div>
                {historyId === listener.id ? (
                  <DeliveryList deliveries={deliveries} error={deliveryError} />
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Edit listener" : "New listener"}</DialogTitle>
            <DialogDescription>
              Profile is required. Use {"{{payload}}"}, {"{{listener}}"}, and {"{{received_at}}"} in the template.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="grid gap-3">
              <Field label="Agent">
                <Select
                  items={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                  value={editor.agentId || null}
                  onValueChange={(next) => next && setEditor({ ...editor, agentId: next })}
                  disabled={Boolean(editor.id)}
                >
                  <SelectTrigger className="w-full" aria-label="Agent">
                    <SelectValue placeholder="Choose an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Name">
                <Input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </Field>
              <Field label="Profile">
                <Select
                  items={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                  value={editor.profileId || null}
                  onValueChange={(next) => next && setEditor({ ...editor, profileId: next })}
                >
                  <SelectTrigger className="w-full" aria-label="Profile">
                    <SelectValue placeholder="Choose a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Prompt template">
                <Textarea
                  value={editor.promptTemplate}
                  placeholder="Leave empty for the default. {{payload}} is wrapped as untrusted data."
                  onChange={(event) => setEditor({ ...editor, promptTemplate: event.target.value })}
                  className="min-h-28"
                />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete listener?</DialogTitle>
            <DialogDescription>The webhook stops accepting events. Chats already created stay.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecretCard({ revealed, onClose }: { revealed: Revealed; onClose: () => void }) {
  const bearer = `curl -X POST '${revealed.url}' \\\n  -H 'Authorization: Bearer ${revealed.secret}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"hello":"world"}'`;
  const signed = `BODY='{"hello":"world"}'\nSIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '${revealed.secret}' | awk '{print $2}')\ncurl -X POST '${revealed.url}' \\\n  -H "X-Botanical-Signature: sha256=$SIG" \\\n  -H 'Content-Type: application/json' \\\n  -d "$BODY"`;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Secret shown once</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Copy the URL and secret now. Later responses will not include the secret. Rotate it if you lose it.</p>
        <CopyRow label="URL" value={revealed.url} />
        <CopyRow label="Secret" value={revealed.secret} />
        <Field label="Bearer">
          <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">{bearer}</pre>
          <Button size="sm" variant="outline" onClick={() => void copyText(bearer)}>
            Copy bearer example
          </Button>
        </Field>
        <Field label="HMAC signature">
          <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">{signed}</pre>
          <Button size="sm" variant="outline" onClick={() => void copyText(signed)}>
            Copy signature example
          </Button>
        </Field>
        <Button variant="outline" onClick={onClose}>
          I have saved the secret
        </Button>
      </CardContent>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">{value}</code>
      <Button size="sm" variant="outline" onClick={() => void copyText(value)}>
        Copy
      </Button>
    </div>
  );
}

function DeliveryList({ deliveries, error }: { deliveries: ListenerDelivery[]; error: string | null }) {
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (deliveries.length === 0) return <p className="text-xs text-muted-foreground">No deliveries yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {deliveries.map((delivery) => (
        <li key={delivery.id} className="flex flex-col gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={delivery.status === "failed" || delivery.status === "rejected" ? "destructive" : "secondary"}>
              {delivery.status}
            </Badge>
            <span>{delivery.httpStatus}</span>
            <span className="text-muted-foreground">{delivery.payloadBytes} bytes</span>
            <span>{formatWhen(delivery.receivedAt)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {delivery.error ? <span className="text-destructive">{delivery.error}</span> : null}
            {delivery.chatId ? (
              <a className="underline underline-offset-2" href={`/chats/${delivery.chatId}`}>
                Open chat
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy");
  }
}
