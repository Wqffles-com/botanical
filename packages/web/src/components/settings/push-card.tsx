"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Label } from "@botanical/ui/components/label";
import { Switch } from "@botanical/ui/components/switch";
import { errorText } from "@/lib/errors";
import {
  currentSubscription,
  disablePush,
  enablePush,
  loadPushState,
  PUSH_EVENT_LABELS,
  pushSupported,
  savePushEvents,
  type PushEventKind,
  type PushState,
} from "@/lib/push";

/** Settings → General: push notifications to this device, and which events send one. */
export function PushCard() {
  const [supported, setSupported] = useState(true);
  const [state, setState] = useState<PushState | null>(null);
  const [thisDevice, setThisDevice] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await loadPushState();
    setState(next);
    const mine = await currentSubscription();
    setThisDevice(Boolean(mine && next.subscriptions.some((item) => item.endpoint === mine.endpoint)));
  }, []);

  useEffect(() => {
    const ok = pushSupported();
    const timer = window.setTimeout(() => {
      setSupported(ok);
      if (ok) void refresh().catch((err: unknown) => toast.error(errorText(err)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function toggleDevice(next: boolean) {
    if (!state?.publicKey) return;
    setBusy(true);
    try {
      if (next) await enablePush(state.publicKey);
      else await disablePush();
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEvent(kind: PushEventKind, value: boolean) {
    if (!state) return;
    const previous = state.events;
    setState({ ...state, events: { ...previous, [kind]: value } });
    try {
      const saved = await savePushEvents({ [kind]: value });
      setState((current) => (current ? { ...current, events: saved.events } : current));
    } catch (err) {
      setState((current) => (current ? { ...current, events: previous } : current));
      toast.error(errorText(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push notifications</CardTitle>
        <CardDescription>
          Get a notification on this device when background work finishes or an agent needs you, even with the tab
          closed. Install Botanical to your home screen first on iPhone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-sm text-muted-foreground">This browser does not support push notifications.</p>
        ) : !state ? null : !state.publicKey ? (
          <p className="text-sm text-muted-foreground">Push is unavailable: the server could not create its keys.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="push-device">Notify this device</Label>
              <Switch
                id="push-device"
                checked={thisDevice}
                disabled={busy}
                onCheckedChange={(checked) => void toggleDevice(checked === true)}
              />
            </div>
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">Send a push for</p>
              {PUSH_EVENT_LABELS.map(({ kind, label, hint }) => (
                <div key={kind} className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor={`push-${kind}`}>{label}</Label>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <Switch
                    id={`push-${kind}`}
                    checked={state.events[kind]}
                    onCheckedChange={(checked) => void toggleEvent(kind, checked === true)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
