"use client";

import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { pageContainerVariants } from "@botanical/ui/components/page-container";
import type { Agent, ModelProfile, Routine, RoutineRun } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { CalendarClock, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PageHeader } from "@botanical/ui/components/page-header";
import { StatusBadge, type StatusTone } from "@botanical/ui/components/status-badge";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@botanical/ui/components/command";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@botanical/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { Switch } from "@botanical/ui/components/switch";
import { Textarea } from "@botanical/ui/components/textarea";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { CRON_PRESETS, browserTimeZone, describeCron, formatWhen, presetForCron, timeZones, type CronPresetId } from "@/lib/schedule";

const EMPTY = {
  agentId: "",
  name: "",
  prompt: "",
  profileId: "",
  timezone: "",
  preset: "daily" as CronPresetId,
  cron: "0 9 * * *",
  enabled: true,
};

export function RoutinesView() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<typeof EMPTY & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);

  async function refresh() {
    const [nextRoutines, nextAgents, nextProfiles] = await Promise.all([
      api.listRoutines(),
      api.listAgents(),
      api.listProfiles(),
    ]);
    setRoutines(nextRoutines);
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

  function openCreate() {
    setEditor({ ...EMPTY, timezone: browserTimeZone() });
  }

  function openEdit(routine: Routine) {
    const preset = presetForCron(routine.cron);
    setEditor({
      id: routine.id,
      agentId: routine.agentId,
      name: routine.name,
      prompt: routine.prompt,
      profileId: routine.profileId,
      timezone: routine.timezone,
      preset,
      cron: routine.cron,
      enabled: routine.enabled,
    });
  }

  async function save() {
    if (!editor) return;
    if (!editor.agentId || !editor.profileId || !editor.name.trim() || !editor.prompt.trim() || !editor.cron.trim()) {
      toast.error("Agent, name, prompt, profile, and schedule are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        agentId: editor.agentId,
        name: editor.name.trim(),
        prompt: editor.prompt,
        cron: editor.cron.trim(),
        timezone: editor.timezone,
        profileId: editor.profileId,
        enabled: editor.enabled,
      };
      if (editor.id) {
        await api.updateRoutine(editor.id, {
          name: payload.name,
          prompt: payload.prompt,
          cron: payload.cron,
          timezone: payload.timezone,
          profileId: payload.profileId,
          enabled: payload.enabled,
        });
      } else {
        await api.createRoutine(payload);
      }
      setEditor(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(routine: Routine, enabled: boolean) {
    try {
      const next = enabled ? await api.resumeRoutine(routine.id) : await api.pauseRoutine(routine.id);
      setRoutines((current) => current.map((item) => (item.id === next.id ? next : item)));
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function runNow(routine: Routine) {
    try {
      await api.runRoutine(routine.id);
      toast.success("Run started");
      await refresh();
      if (historyId === routine.id) await loadRuns(routine.id);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function loadRuns(id: string) {
    setHistoryId(id);
    setRunsError(null);
    try {
      setRuns(await api.listRoutineRuns(id, { limit: 20 }));
    } catch (err) {
      setRuns([]);
      setRunsError(errorText(err));
    }
  }

  async function remove() {
    if (!removeId) return;
    try {
      await api.deleteRoutine(removeId);
      setRemoveId(null);
      if (historyId === removeId) setHistoryId(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const agentName = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents]);

  return (
    <div className={pageContainerVariants()}>
      <PageHeader
        title="Routines"
        description="Scheduled runs. Each run opens a new chat so the history stays bounded to that slot."
        actions={!loading && routines.length > 0 ? <Button onClick={openCreate}>New routine</Button> : undefined}
      />
      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-6 space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : routines.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No routines yet"
            body="Run an agent on a schedule while you are away. Each run opens its own chat."
            action={<Button onClick={openCreate}>New routine</Button>}
            bordered
          />
        ) : (
          routines.map((routine) => (
            <Card key={routine.id}>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="truncate">{routine.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {agentName.get(routine.agentId) ?? "Unknown agent"} · {describeCron(routine.cron)} · {routine.timezone}
                  </p>
                  <p className="mt-0.5 font-mono text-2xs text-muted-foreground">{routine.cron}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`enabled-${routine.id}`} className="text-xs text-muted-foreground">
                    {routine.enabled ? "On" : "Paused"}
                  </Label>
                  <Switch
                    id={`enabled-${routine.id}`}
                    checked={routine.enabled}
                    aria-label={`${routine.enabled ? "Pause" : "Resume"} ${routine.name}`}
                    onCheckedChange={(checked) => void toggle(routine, checked === true)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Next {formatWhen(routine.nextRunAt, routine.timezone)}</span>
                  <span className="inline-flex items-center gap-1">
                    Last {routine.lastRun ? <RunStatus status={routine.lastRun.status} /> : "—"}
                    {routine.lastRunAt ? formatWhen(routine.lastRunAt, routine.timezone) : null}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void runNow(routine)}>
                    Run now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void loadRuns(routine.id)}>
                    History
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(routine)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="destructive" className="sm:ml-auto" onClick={() => setRemoveId(routine.id)}>
                    Delete
                  </Button>
                </div>
                {historyId === routine.id ? (
                  <RunHistory runs={runs} error={runsError} timeZone={routine.timezone} />
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Edit routine" : "New routine"}</DialogTitle>
            <DialogDescription>Pick an agent and a profile. There is no default model.</DialogDescription>
          </DialogHeader>
          {editor ? (
            <RoutineForm
              value={editor}
              agents={agents}
              profiles={profiles}
              onChange={setEditor}
            />
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

      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Delete routine?"
        description="Past chats stay. The schedule and its run history are removed."
        pending={false}
        pendingLabel="Deleting…"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function RoutineForm({
  value,
  agents,
  profiles,
  onChange,
}: {
  value: typeof EMPTY & { id?: string };
  agents: Agent[];
  profiles: ModelProfile[];
  onChange: (next: typeof EMPTY & { id?: string }) => void;
}) {
  const zones = useMemo(() => timeZones(), []);
  const [preview, setPreview] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .previewRoutine(value.cron, value.timezone)
        .then((result) => {
          if (cancelled) return;
          if (!result.valid) {
            setPreview([]);
            setPreviewError(result.error ?? "Invalid schedule");
            return;
          }
          setPreviewError(null);
          setPreview(result.next);
        })
        .catch((err: unknown) => {
          if (!cancelled) setPreviewError(errorText(err));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value.cron, value.timezone]);

  return (
    <div className="grid gap-3">
      <Field label="Agent">
        <Select
          items={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
          value={value.agentId || null}
          onValueChange={(next) => next && onChange({ ...value, agentId: next })}
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
        <Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
      </Field>
      <Field label="Prompt">
        <Textarea
          value={value.prompt}
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          className="min-h-28"
        />
      </Field>
      <Field label="Profile">
        <Select
          items={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
          value={value.profileId || null}
          onValueChange={(next) => next && onChange({ ...value, profileId: next })}
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
      <Field label="Schedule">
        <Select
          items={CRON_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          value={value.preset}
          onValueChange={(next) => {
            if (!next) return;
            const preset = CRON_PRESETS.find((item) => item.id === next);
            onChange({
              ...value,
              preset: next as CronPresetId,
              cron: preset && preset.id !== "custom" ? preset.cron : value.cron,
            });
          }}
        >
          <SelectTrigger className="w-full" aria-label="Schedule preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRON_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {value.preset === "custom" ? (
        <Field label="Cron">
          <Input
            value={value.cron}
            onChange={(event) => onChange({ ...value, cron: event.target.value })}
            placeholder="0 9 * * 1-5"
            spellCheck={false}
          />
        </Field>
      ) : null}
      <div className="space-y-0.5">
        <p className="text-sm">{value.cron.trim() ? describeCron(value.cron) : "Choose a schedule"}</p>
        <p className="font-mono text-2xs text-muted-foreground">{value.cron.trim() || "—"}</p>
      </div>
      <Field label="Timezone">
        <TimeZoneField zones={zones} value={value.timezone} onChange={(timezone) => onChange({ ...value, timezone })} />
      </Field>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="font-medium">Next runs{value.timezone ? ` (${value.timezone})` : ""}</p>
        {previewError ? (
          <p className="text-destructive">{previewError}</p>
        ) : preview.length === 0 ? (
          <p>Next runs appear here.</p>
        ) : (
          <ul className="space-y-0.5">
            {preview.map((stamp) => (
              <li key={stamp}>{formatWhen(stamp, value.timezone)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TimeZoneField({
  zones,
  value,
  onChange,
}: {
  zones: string[];
  value: string;
  onChange: (timezone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" className="w-full justify-between px-2.5 font-normal" />
        }
      >
        <span className="truncate">{value || "Choose a timezone"}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  data-checked={zone === value || undefined}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  {zone}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RunHistory({ runs, error, timeZone }: { runs: RoutineRun[]; error: string | null; timeZone: string }) {
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (runs.length === 0) return <p className="text-xs text-muted-foreground">No runs yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-col gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-wrap items-center gap-2">
            <RunStatus status={run.status} />
            <span className="text-muted-foreground">{run.trigger}</span>
            <span>{formatWhen(run.scheduledFor, timeZone)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {run.error ? <span className="text-destructive">{run.error}</span> : null}
            {run.chatId ? (
              <a className="underline underline-offset-2" href={`/chats/${run.chatId}`}>
                Open chat
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RunStatus({ status }: { status: string }) {
  const tone: StatusTone =
    status === "failed" || status === "rejected"
      ? "danger"
      : status === "succeeded"
        ? "success"
        : status === "running" || status === "queued"
          ? "progress"
          : "neutral";
  return (
    <StatusBadge tone={tone} className="capitalize">
      {status}
    </StatusBadge>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
