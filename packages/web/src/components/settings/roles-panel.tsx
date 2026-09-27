"use client";

import type { Agent, RolePermissions, RoleRecord } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PermissionsSummary } from "@/components/permissions-summary";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { errorText, roleDeleteText } from "@/lib/errors";
import { fetchMcpServers } from "@/lib/mvp-api";
import { CAPABILITY_OPTIONS, orderCapabilities } from "@/lib/permissions";

type GrantDraft = { server: string; tools: string };

type RoleDraft = {
  id: string | null;
  name: string;
  description: string;
  capabilities: string[];
  grants: GrantDraft[];
  builtin: boolean;
};

const EMPTY_DRAFT: RoleDraft = {
  id: null,
  name: "",
  description: "",
  capabilities: [],
  grants: [{ server: "", tools: "" }],
  builtin: false,
};

export function RolesPanel({ agents, onAgentsChanged }: { agents: Agent[]; onAgentsChanged: () => Promise<void> }) {
  const router = useRouter();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [servers, setServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RoleRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listRoles(), fetchMcpServers().catch(() => null)])
      .then(([nextRoles, mcp]) => {
        if (cancelled) return;
        setRoles(nextRoles);
        setServers(mcp?.servers.map((server) => server.id) ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          router.replace("/login");
          return;
        }
        setError(errorText(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const serverOptions = useMemo(() => ["*", ...servers.filter((id) => id !== "*")], [servers]);

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT, grants: [{ server: "", tools: "" }] });
  }

  function openEdit(role: RoleRecord) {
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description,
      capabilities: [...role.permissions.capabilities],
      grants:
        role.permissions.mcp.length > 0
          ? role.permissions.mcp.map((grant) => ({ server: grant.server, tools: (grant.tools ?? []).join(", ") }))
          : [{ server: "", tools: "" }],
      builtin: role.builtin,
    });
  }

  async function toggleCapability(role: RoleRecord, capability: string, on: boolean) {
    const previous = role.permissions;
    const capabilities = orderCapabilities(
      on ? [...role.permissions.capabilities, capability] : role.permissions.capabilities.filter((item) => item !== capability),
    );
    const permissions: RolePermissions = { ...previous, capabilities };
    setRoles((current) => current.map((item) => (item.id === role.id ? { ...item, permissions } : item)));
    try {
      const saved = await api.updateRole(role.id, { permissions });
      setRoles((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      // Effective permissions on agents depend on role permissions.
      void onAgentsChanged();
    } catch (err) {
      setRoles((current) => current.map((item) => (item.id === role.id ? { ...item, permissions: previous } : item)));
      toast.error(errorText(err));
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!draft.builtin && !name) {
      toast.error("Name the role.");
      return;
    }
    const permissions: RolePermissions = {
      capabilities: orderCapabilities(draft.capabilities),
      mcp: draft.grants
        .map((grant) => {
          const server = grant.server.trim();
          if (!server) return null;
          const tools = grant.tools
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          return tools.length > 0 ? { server, tools } : { server };
        })
        .filter((grant): grant is { server: string; tools?: string[] } => grant !== null),
    };
    setSaving(true);
    try {
      const saved = draft.id
        ? await api.updateRole(draft.id, {
            ...(draft.builtin ? {} : { name }),
            description: draft.description.trim(),
            permissions,
          })
        : await api.createRole({ name, description: draft.description.trim(), permissions });
      setRoles((current) => {
        const rest = current.filter((item) => item.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setDraft(null);
      toast.success(draft.id ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
      if (draft.id) void onAgentsChanged();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function tryDeleteBuiltin(role: RoleRecord) {
    // The server is the source of truth: it answers 409 builtin_role.
    try {
      await api.deleteRole(role.id);
      setRoles((current) => current.filter((item) => item.id !== role.id));
      toast.success(`Deleted ${role.name}.`);
    } catch (err) {
      toast.error(roleDeleteText(err) ?? errorText(err));
    }
  }

  async function removeRole() {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await api.deleteRole(pendingDelete.id);
      setRoles((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.success(`Deleted ${pendingDelete.name}.`);
    } catch (err) {
      toast.error(roleDeleteText(err) ?? errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function assign(agent: Agent, roleId: string, on: boolean) {
    const next = on ? [...new Set([...agent.roleIds, roleId])] : agent.roleIds.filter((id) => id !== roleId);
    try {
      await api.setAgentRoles(agent.id, next);
      await onAgentsChanged();
      toast.success(`Updated roles for ${agent.name}.`);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading roles…</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Roles</h2>
            <p className="text-xs text-muted-foreground">Built-in roles can change permissions. Their names stay fixed.</p>
          </div>
          <Button type="button" onClick={openCreate}>
            New role
          </Button>
        </div>
        <ul className="divide-y rounded-xl border">
          {roles.map((role) => (
            <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{role.name}</span>
                  {role.builtin ? <Badge variant="outline">Built-in</Badge> : null}
                </div>
                {role.description ? <p className="mt-1 text-xs text-muted-foreground">{role.description}</p> : null}
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(role)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={role.builtin ? "text-muted-foreground" : undefined}
                  title={role.builtin ? "Built-in roles can't be deleted" : undefined}
                  onClick={() => (role.builtin ? void tryDeleteBuiltin(role) : setPendingDelete(role))}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Capabilities</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Capability</th>
                {roles.map((role) => (
                  <th key={role.id} className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_OPTIONS.map((capability) => (
                <tr key={capability.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <div>{capability.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{capability.id}</div>
                  </td>
                  {roles.map((role) => {
                    const on = role.permissions.capabilities.includes(capability.id);
                    return (
                      <td key={role.id} className="px-3 py-2">
                        <Switch
                          size="sm"
                          checked={on}
                          aria-label={`${role.name} ${capability.label}`}
                          onCheckedChange={(checked) => void toggleCapability(role, capability.id, checked === true)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Agent assignments</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => (
              <li key={agent.id} className="rounded-xl border px-3 py-3">
                <div className="text-sm font-medium">{agent.name}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  {roles.map((role) => {
                    const checked = agent.roleIds.includes(role.id);
                    return (
                      <label key={role.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-foreground"
                          checked={checked}
                          onChange={(event) => void assign(agent, role.id, event.target.checked)}
                        />
                        <span>{role.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <PermissionsSummary permissions={agent.effectivePermissions} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[min(40rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.name || "role"}` : "New role"}</DialogTitle>
            <DialogDescription>Capabilities and MCP servers this role is allowed to use.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={draft.name}
                  disabled={draft.builtin}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="role-description">Description</Label>
                <Textarea
                  id="role-description"
                  value={draft.description}
                  rows={2}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Capabilities</legend>
                {CAPABILITY_OPTIONS.map((capability) => {
                  const on = draft.capabilities.includes(capability.id);
                  return (
                    <label key={capability.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {capability.label}
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{capability.id}</span>
                      </span>
                      <Switch
                        size="sm"
                        checked={on}
                        aria-label={capability.label}
                        onCheckedChange={(checked) => {
                          const capabilities = checked
                            ? [...draft.capabilities, capability.id]
                            : draft.capabilities.filter((item) => item !== capability.id);
                          setDraft({ ...draft, capabilities });
                        }}
                      />
                    </label>
                  );
                })}
              </fieldset>
              <div className="grid gap-2">
                <div className="text-sm font-medium">MCP allow list</div>
                <p className="text-xs text-muted-foreground">
                  Server id, or * for every server. Tools are optional and comma-separated. Leave tools empty to allow the whole server.
                </p>
                {serverOptions.length > 0 ? (
                  <datalist id="mcp-server-options">
                    {serverOptions.map((server) => (
                      <option key={server} value={server} />
                    ))}
                  </datalist>
                ) : (
                  <p className="text-xs text-muted-foreground">No MCP servers are connected. You can still type a server id.</p>
                )}
                {draft.grants.map((grant, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={grant.server}
                      list="mcp-server-options"
                      placeholder="server or *"
                      aria-label="MCP server"
                      onChange={(event) => {
                        const grants = draft.grants.map((item, i) =>
                          i === index ? { ...item, server: event.target.value } : item,
                        );
                        setDraft({ ...draft, grants });
                      }}
                    />
                    <Input
                      value={grant.tools}
                      placeholder="tools, optional"
                      aria-label="MCP tools"
                      onChange={(event) => {
                        const grants = draft.grants.map((item, i) =>
                          i === index ? { ...item, tools: event.target.value } : item,
                        );
                        setDraft({ ...draft, grants });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDraft({ ...draft, grants: draft.grants.filter((_, i) => i !== index) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft({ ...draft, grants: [...draft.grants, { server: "", tools: "" }] })}
                >
                  Add server
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveDraft()}>
              {draft?.id ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name ?? "this role"}?</DialogTitle>
            <DialogDescription>Agents using it have to be unassigned first.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void removeRole()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
