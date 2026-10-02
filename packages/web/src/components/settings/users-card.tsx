"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@botanical/ui/components/button";
import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { StatusBadge } from "@botanical/ui/components/status-badge";
import { relativeTime } from "@/lib/format";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
  createdAt: string;
  lastActiveAt: string | null;
  disabledAt: string | null;
};

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

async function fetchUsers(): Promise<AdminUser[]> {
  const response = await request("/api/admin/users");
  return ((await response.json()) as { users: AdminUser[] }).users;
}

export function UsersCard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [resetUrl, setResetUrl] = useState<{ userId: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    setUsers(await fetchUsers());
  }

  useEffect(() => {
    void fetchUsers()
      .then(setUsers)
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

  async function change(user: AdminUser, patch: { disabled?: boolean; role?: "admin" | "member" }, done: string) {
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the user");
    }
  }

  async function remove(user: AdminUser) {
    setPending(true);
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      setRemoving(null);
      await load();
      toast.success(`${user.displayName} deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the user");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Everyone with an account. Disabling blocks sign-in and ends their sessions; their data stays. A reset link
          is one-time, valid for 24 hours, and signs them out everywhere. Send it to them yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3" data-testid="admin-users">
        {users.map((user) => (
          <div key={user.id} className="space-y-1" data-testid={`user-row-${user.email}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{user.displayName}</span>
                  {user.role === "admin" ? <StatusBadge tone="info">Admin</StatusBadge> : null}
                  {user.disabledAt ? <StatusBadge tone="warning">Disabled</StatusBadge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {user.email} · created {relativeTime(user.createdAt)} ago · last active{" "}
                  {user.lastActiveAt ? `${relativeTime(user.lastActiveAt)} ago` : "never"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`reset-link-${user.email}`}
                  onClick={() => void createResetLink(user.id)}
                >
                  Reset link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`toggle-admin-${user.email}`}
                  onClick={() =>
                    void change(
                      user,
                      { role: user.role === "admin" ? "member" : "admin" },
                      user.role === "admin" ? "Admin removed" : "Made admin",
                    )
                  }
                >
                  {user.role === "admin" ? "Remove admin" : "Make admin"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`toggle-disabled-${user.email}`}
                  onClick={() =>
                    void change(
                      user,
                      { disabled: !user.disabledAt },
                      user.disabledAt ? "Account enabled" : "Account disabled",
                    )
                  }
                >
                  {user.disabledAt ? "Enable" : "Disable"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  data-testid={`delete-user-${user.email}`}
                  onClick={() => setRemoving(user)}
                >
                  Delete
                </Button>
              </div>
            </div>
            {resetUrl?.userId === user.id ? (
              <p className="break-all font-mono text-xs" data-testid="reset-url">
                {resetUrl.url}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && !pending && setRemoving(null)}
        title={`Delete ${removing?.displayName ?? "this user"}?`}
        description={`This permanently deletes ${removing?.email ?? "the account"} together with their agents, chats and messages, routines, listeners, notifications, memories, personal models and keys. It cannot be undone. If their tool activity is in the audit log, the account cannot be deleted; disable it instead.`}
        confirmLabel="Delete user"
        pending={pending}
        pendingLabel="Deleting…"
        onConfirm={() => removing && void remove(removing)}
      />
    </Card>
  );
}
