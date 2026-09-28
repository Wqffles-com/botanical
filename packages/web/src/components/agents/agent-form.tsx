"use client";

import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { pageContainerVariants } from "@botanical/ui/components/page-container";
import type { Agent, RoleRecord } from "@botanical/core";
import { useRef, useState, type FormEvent } from "react";
import { ImageUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/agent-avatar";
import { PermissionsSummary } from "@/components/permissions-summary";
import { RoleBadges } from "@/components/role-badges";
import { AgentColorPicker } from "@/components/agents/agent-color-picker";
import { AgentIconPicker } from "@/components/agents/agent-icon-picker";
import { AgentShapePicker } from "@/components/agents/agent-shape-picker";
import { AgentToolAllowlist } from "@/components/agents/agent-tool-allowlist";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@botanical/ui/components/button";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";
import { Textarea } from "@botanical/ui/components/textarea";
import { previewEffective } from "@/lib/permissions";
import { createAgent, deleteAgent, updateAgent } from "@/lib/agent-api";
import { fileToAgentPicture } from "@/lib/agent-picture";
import {
  AGENT_DESCRIPTION_MAX,
  AGENT_NAME_MAX,
  AGENT_TITLE_MAX,
  EMPTY_AGENT_DRAFT,
  draftFromIdentity,
  validateAgentDraft,
  type AgentDraft,
  type AgentIdentity,
  type ProfileInfo,
  type ToolInfo,
} from "@/lib/agent-identity";
import type { AgentShape } from "@botanical/core";
import type { AgentIconName } from "@/lib/agent-icons";

export function AgentForm({
  agent,
  tools,
  profiles,
  roles = [],
  agents = [],
  toolsLoading,
}: {
  agent?: AgentIdentity | null;
  tools: ToolInfo[];
  profiles: ProfileInfo[];
  roles?: RoleRecord[];
  agents?: Agent[];
  toolsLoading?: boolean;
}) {
  const router = useRouter();
  const { refresh } = useWorkspace();
  const agentKey = agent ? `${agent.id}:${agent.updatedAt}` : "new";
  const [seenKey, setSeenKey] = useState(agentKey);
  const [draft, setDraft] = useState<AgentDraft>(agent ? draftFromIdentity(agent) : EMPTY_AGENT_DRAFT);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pictureInput = useRef<HTMLInputElement>(null);
  if (seenKey !== agentKey) {
    setSeenKey(agentKey);
    setDraft(agent ? draftFromIdentity(agent) : EMPTY_AGENT_DRAFT);
  }

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
  const creator = agent?.createdByAgentId ? agents.find((item) => item.id === agent.createdByAgentId) : null;
  const rolesMatchSaved =
    !!agent &&
    agent.roleIds.length === draft.roleIds.length &&
    agent.roleIds.every((id) => draft.roleIds.includes(id));
  const effective = rolesMatchSaved ? agent.effectivePermissions : previewEffective(draft.roleIds, roles);

  return (
    <form onSubmit={(event) => void onSubmit(event)} data-testid="agent-editor" className={pageContainerVariants({ size: "narrow" })}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar
            name={draft.name || "New agent"}
            icon={draft.icon}
            color={draft.color}
            shape={draft.shape}
            picture={draft.picture}
            size="xl"
          />
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-tight">{title}</h1>
            {agent ? <RoleBadges roles={agent.roles} /> : null}
            <p className="mt-1 text-sm text-muted-foreground">
              Name, title, shape, and picture show up in the sidebar, chat header, and messages.
            </p>
            {agent?.createdByAgentId ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Created by{" "}
                <Link href={`/agents/${encodeURIComponent(agent.createdByAgentId)}`} className="underline-offset-2 hover:underline">
                  {creator?.name ?? "another agent"}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="agent-name">Name</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {draft.name.trim().length}/{AGENT_NAME_MAX}
            </span>
          </div>
          <Input
            id="agent-name"
            value={draft.name}
            maxLength={AGENT_NAME_MAX}
            placeholder="Name your agent"
            onChange={(event) => patch({ name: event.target.value })}
            required
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="agent-title">Title</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              Short role label · {draft.title.trim().length}/{AGENT_TITLE_MAX}
            </span>
          </div>
          <Input
            id="agent-title"
            value={draft.title}
            maxLength={AGENT_TITLE_MAX}
            placeholder="What it does, in a few words"
            onChange={(event) => patch({ title: event.target.value })}
          />
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

        <div className="grid gap-6 sm:grid-cols-2 sm:gap-4">
          <div className="grid content-start gap-2">
            <Label>Icon</Label>
            <AgentIconPicker
              value={draft.icon}
              color={draft.color}
              onChange={(icon: AgentIconName) => patch({ icon })}
            />
          </div>
          <div className="grid content-start gap-2">
            <Label>Color</Label>
            {/* Match the icon picker's 40px row so both columns line up. */}
            <div className="flex min-h-10 items-center">
              <AgentColorPicker value={draft.color} onChange={(color) => patch({ color })} />
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Shape</Label>
          <AgentShapePicker
            value={draft.shape}
            color={draft.color}
            icon={draft.icon}
            onChange={(shape: AgentShape) => patch({ shape })}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-picture">Picture</Label>
          <p className="text-xs text-muted-foreground">
            Shown instead of the shape. PNG, JPEG, or WebP. Clear it to go back to the shape.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <AgentAvatar
              name={draft.name || "New agent"}
              icon={draft.icon}
              color={draft.color}
              shape={draft.shape}
              picture={draft.picture}
              size="md"
            />
            <Button type="button" variant="outline" disabled={saving} onClick={() => pictureInput.current?.click()}>
              <ImageUp />
              {draft.picture ? "Replace picture" : "Upload picture"}
            </Button>
            <input
              ref={pictureInput}
              id="agent-picture"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              disabled={saving}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void fileToAgentPicture(file)
                  .then((picture) => patch({ picture }))
                  .catch((error: unknown) => {
                    toast.error(error instanceof Error ? error.message : "Could not read that image.");
                  });
              }}
            />
            {draft.picture ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => patch({ picture: null })}>
                Clear picture
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-prompt">Prompt</Label>
          <Textarea
            id="agent-prompt"
            value={draft.prompt}
            rows={12}
            placeholder="You are…"
            className="min-h-48 font-mono text-sm leading-relaxed"
            onChange={(event) => patch({ prompt: event.target.value })}
          />
        </div>

        <div className="grid gap-2">
          <Label>Roles</Label>
          <p className="text-xs text-muted-foreground">
            An agent with no roles is limited only by its tool allowlist. Roles add a capability ceiling.
          </p>
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles yet. Create them in Settings.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {roles.map((role) => {
                const checked = draft.roleIds.includes(role.id);
                return (
                  <label key={role.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-foreground"
                      checked={checked}
                      disabled={saving}
                      onChange={(event) => {
                        const roleIds = event.target.checked
                          ? [...draft.roleIds, role.id]
                          : draft.roleIds.filter((id) => id !== role.id);
                        patch({ roleIds });
                      }}
                    />
                    <span>{role.name}</span>
                    {role.builtin ? <span className="text-xs text-muted-foreground">Built-in</span> : null}
                  </label>
                );
              })}
            </div>
          )}
          <PermissionsSummary permissions={effective} />
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
              <option key={profile.id} value={profile.id} disabled={!profile.available}>
                {profile.name}
                {profile.model ? ` · ${profile.model}` : ""}
                {profile.available ? "" : ` — ${profile.unavailableReason ?? "Unavailable"}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        {agent ? (
          <Button
            type="button"
            variant="destructive"
            className="mr-auto"
            onClick={() => setConfirmDelete(true)}
            disabled={saving}
          >
            Delete
          </Button>
        ) : null}
        <Button type="submit" disabled={saving || !draft.name.trim() || !draft.prompt.trim()}>
          {saving ? "Saving…" : agent ? "Save" : "Create agent"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title={`Delete ${agent?.name ?? "this agent"}?`}
        description="Existing chats keep their history but cannot start new turns with a missing agent."
        pending={saving}
        pendingLabel="Deleting…"
        onConfirm={() => void onDelete()}
      />
    </form>
  );
}
