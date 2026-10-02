"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@botanical/ui/components/badge";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";

type SessionRow = { id: string; createdAt: string; expiresAt: string; current: boolean };

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

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function fetchSessions(): Promise<SessionRow[]> {
  const response = await request("/api/auth/sessions");
  const body = (await response.json()) as { sessions: SessionRow[] };
  return body.sessions;
}

export function AccountCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const loadSessions = useCallback(async () => {
    setSessions(await fetchSessions());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    try {
      await request("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent("");
      setNext("");
      toast.success("Password changed. Other devices were signed out.");
      await loadSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the password.");
    } finally {
      setPending(false);
    }
  }

  async function signOutOthers() {
    try {
      await request("/api/auth/sessions", { method: "DELETE" });
      toast.success("Signed out everywhere else");
      await loadSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out other sessions.");
    }
  }

  async function revoke(id: string) {
    try {
      await request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out that session.");
    }
  }

  const others = sessions.filter((row) => !row.current);

  return (
    <Card data-testid="account-card">
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Change your password and manage where you are signed in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={(event) => void changePassword(event)} className="grid max-w-sm gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              data-testid="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              data-testid="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || !current || !next} data-testid="change-password">
            Change password
          </Button>
        </form>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Active sessions</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={others.length === 0}
              data-testid="sign-out-others"
              onClick={() => void signOutOthers()}
            >
              Sign out everywhere else
            </Button>
          </div>
          <ul className="divide-y rounded-lg border" data-testid="session-list">
            {sessions.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  Signed in {when(row.createdAt)}
                  {row.current ? (
                    <Badge variant="secondary" className="ml-2">
                      This device
                    </Badge>
                  ) : null}
                </span>
                {row.current ? null : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void revoke(row.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
