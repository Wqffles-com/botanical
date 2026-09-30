"use client";

import type { GithubConnection, GithubRepo, Listener } from "@botanical/core";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@botanical/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@botanical/ui/components/dialog";
import { Input } from "@botanical/ui/components/input";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { useAppDialogs } from "@/components/app-dialogs";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Creates the webhook for a GitHub listener on one repository, with the connected account.
 * The server sends the listener's URL, secret, and events; the secret never reaches the browser.
 */
export function GithubHookDialog({ listener, onClose }: { listener: Listener | null; onClose: () => void }) {
  const { openSettings } = useAppDialogs();
  const [connection, setConnection] = useState<GithubConnection | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!listener) return;
    let cancelled = false;
    setConnection(null);
    setRepos(null);
    setPicked(null);
    setQuery("");
    setError(null);
    void (async () => {
      try {
        const next = await api.getGithub();
        if (cancelled) return;
        setConnection(next);
        if (next.connected) {
          const listed = await api.listGithubRepos();
          if (!cancelled) setRepos(listed);
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listener]);

  async function create() {
    if (!listener || !picked) return;
    setSaving(true);
    try {
      const hook = await api.createListenerGithubHook(listener.id, picked);
      toast.success(`Webhook added to ${hook.repo}`);
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const shown = (repos ?? []).filter((repo) => repo.fullName.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Dialog open={listener !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
          <DialogDescription>
            Botanical adds a webhook to the repository so GitHub sends this listener its events. You need admin access
            to the repository. Connect again after you change the events or rotate the secret.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !connection ? (
          <Skeleton className="h-40 w-full" />
        ) : !connection.connected ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Connect your GitHub account first.</p>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                openSettings("github");
              }}
            >
              Open GitHub settings
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <Input
              aria-label="Filter repositories"
              placeholder="Filter repositories"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {repos === null ? (
              <Skeleton className="h-40 w-full" />
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No repositories match.</p>
            ) : (
              <ul role="listbox" aria-label="Repositories" className="scrollbar-thin max-h-64 divide-y overflow-y-auto rounded-lg border">
                {shown.map((repo) => (
                  <li key={repo.fullName}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={picked === repo.fullName}
                      disabled={!repo.canAdmin}
                      onClick={() => setPicked(repo.fullName)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
                        picked === repo.fullName ? "bg-accent" : "hover:bg-accent/50",
                      )}
                    >
                      <span className="min-w-0 truncate">{repo.fullName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {repo.canAdmin ? (repo.private ? "Private" : "Public") : "No admin access"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={saving || !picked}>
            {saving ? "Adding…" : "Add webhook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
