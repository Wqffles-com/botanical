"use client";

import type { AlwaysOnSettings } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";

export function BackgroundWorkCard() {
  const router = useRouter();
  const [settings, setSettings] = useState<AlwaysOnSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAlwaysOnSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          router.replace("/login");
          return;
        }
        setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await api.updateAlwaysOnSettings(settings);
      setSettings(next);
      toast.success("Background work settings saved.");
    } catch (err) {
      if (isUnauthorized(err)) {
        router.replace("/login");
        return;
      }
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Background work</CardTitle>
        <CardDescription>
          Instance settings for the scheduler, background turns, and webhook size. A saved change applies within a
          minute, without a restart. This card is for the instance admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {settings ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="always-on-scheduler">Run the scheduler</Label>
              <Switch
                id="always-on-scheduler"
                checked={settings.schedulerEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, schedulerEnabled: checked === true })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField
                id="always-on-interval"
                label="Tick interval (ms)"
                hint="1000–3600000"
                value={settings.schedulerIntervalMs}
                onChange={(schedulerIntervalMs) => setSettings({ ...settings, schedulerIntervalMs })}
              />
              <NumberField
                id="always-on-concurrency"
                label="Background turns"
                hint="1–32"
                value={settings.backgroundConcurrency}
                onChange={(backgroundConcurrency) => setSettings({ ...settings, backgroundConcurrency })}
              />
              <NumberField
                id="always-on-bytes"
                label="Webhook max bytes"
                hint="1–5000000"
                value={settings.listenerMaxBytes}
                onChange={(listenerMaxBytes) => setSettings({ ...settings, listenerMaxBytes })}
              />
            </div>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        ) : error ? null : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
