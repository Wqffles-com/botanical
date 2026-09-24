"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentColorPicker } from "@/components/agents/agent-color-picker";
import { AgentIconPicker } from "@/components/agents/agent-icon-picker";
import { AgentToolAllowlist } from "@/components/agents/agent-tool-allowlist";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAgent, deleteAgent, updateAgent } from "@/lib/agent-api";
import {
  AGENT_DESCRIPTION_MAX,
  AGENT_NAME_MAX,
  EMPTY_AGENT_DRAFT,
  draftFromIdentity,
  validateAgentDraft,
  type AgentDraft,
  type AgentIdentity,
  type ProfileInfo,
  type ToolInfo,
} from "@/lib/agent-identity";
import type { AgentIconName } from "@/lib/agent-icons";

export function AgentForm({
  agent,
  tools,
  profiles,
  toolsLoading,
}: {
  agent?: AgentIdentity | null;
  tools: ToolInfo[];
  profiles: ProfileInfo[];
  toolsLoading?: boolean;
}) {
  const router = useRouter();
  const { refresh } = useWorkspace();
  const [draft, setDraft] = useState<AgentDraft>(agent ? draftFromIdentity(agent) : EMPTY_AGENT_DRAFT);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setDraft(agent ? draftFromIdentity(agent) : EMPTY_AGENT_DRAFT);
  }, [agent]);

  function patch(partial: Partial<AgentDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateAgentDraft(draft);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      if (agent) {
        const saved = await updateAgent(agent.id, draft);
        await refresh();
        toast.success(`Saved ${saved.name}.`);
        router.refresh();
      } else {
        const created = await createAgent(draft);
        await refresh();
        toast.success(`Created ${created.name}.`);
        router.push(`/agents/${encodeURIComponent(created.id)}`);
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the agent.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!agent) return;
    setSaving(true);
    try {
      await deleteAgent(agent.id);
      await refresh();
      toast.success(`Deleted ${agent.name}.`);
      setConfirmDelete(false);
      router.push("/agents");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the agent.");
    } finally {
      setSaving(false);
    }
  }

  const title = agent ? agent.name || "Edit agent" : "New agent";

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar name={draft.name || "New agent"} icon={draft.icon} color={draft.color} size="xl" />
          <div className="min-w-0">
            <h1 className="truncate font-heading text-3xl tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Icon, color, and name show up in the picker, sidebar, chat header, and messages.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {agent ? (
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
              Delete
            </Button>
          ) : null}
          <Button type="submit" disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>
            {saving ? "Saving…" : agent ? "Save" : "Create agent"}
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={draft.name}
            maxLength={AGENT_NAME_MAX}
            placeholder="Gardener"
            onChange={(event) => patch({ name: event.target.value })}
            required
          />
          <p className="text-xs text-muted-foreground">
            {draft.name.trim().length}/{AGENT_NAME_MAX}
          </p>
        </div>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="agent-description">Description</Label>
            <span className="text-xs text-muted-foreground">Shown in pickers</span>
          </div>
          <Input
            id="agent-description"
            value={draft.description}
            maxLength={AGENT_DESCRIPTION_MAX}
            placeholder="What this agent is for"
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Icon</Label>
            <AgentIconPicker
              value={draft.icon}
              color={draft.color}
              onChange={(icon: AgentIconName) => patch({ icon })}
            />
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <AgentColorPicker value={draft.color} onChange={(color) => patch({ color })} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-prompt">Prompt</Label>
          <Textarea
            id="agent-prompt"
            value={draft.prompt}
            rows={12}
            placeholder="You are…"
            className="min-h-48 font-mono text-[13px] leading-relaxed"
            onChange={(event) => patch({ prompt: event.target.value })}
          />
        </div>

        <div className="grid gap-2">
          <Label>Tools</Label>
          <p className="text-xs text-muted-foreground">
            Allowlist for this agent. Built-ins and MCP tools come from the server.
          </p>
          <AgentToolAllowlist
            tools={tools}
            value={draft.tools}
            onChange={(next) => patch({ tools: next })}
            loading={toolsLoading}
            disabled={saving}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-profile">Suggested profile</Label>
          <p className="text-xs text-muted-foreground">
            Optional hint only. Every chat still requires an explicit profile pick.
          </p>
          <select
            id="agent-profile"
            value={draft.defaultProfileId ?? ""}
            onChange={(event) => patch({ defaultProfileId: event.target.value || null })}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">No suggestion</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.model ? ` · ${profile.model}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {agent?.name ?? "this agent"}?</DialogTitle>
            <DialogDescription>
              Existing chats keep their history but cannot start new turns with a missing agent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void onDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
