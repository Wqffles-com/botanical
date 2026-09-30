"use client";

import type { GithubConnection } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@botanical/ui/components/avatar";
import { Badge } from "@botanical/ui/components/badge";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { StatusBadge } from "@botanical/ui/components/status-badge";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { tokenSettingsUrl } from "@/lib/github";
import { formatWhen } from "@/lib/schedule";

/**
 * The signed-in user's GitHub connection. The token is sent once and stays on the server;
 * agents act with it through the git and GitHub tools and GitHub listeners.
 */
export function GithubPanel() {
  const [connection, setConnection] = useState<GithubConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getGithub()
      .then((next) => {
        if (!cancelled) setConnection(next);
      })
      .catch((err: unknown) => {
        if (!cancelled && !isUnauthorized(err)) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      const next = await api.connectGithub(token.trim());
      setConnection(next);
      setToken("");
      toast.success(next.account ? `Connected as ${next.account.login}` : "GitHub connected");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      await api.disconnectGithub();
      setConnection((current) => (current ? { ...current, connected: false, account: null } : current));
      toast.success("GitHub disconnected");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!connection) return <Skeleton className="h-48 w-full" />;
  const account = connection.account;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>GitHub account</CardTitle>
          <CardDescription>
            Your agents use this account to clone and push repositories, work on issues and pull requests, and
            receive GitHub events. The token is stored encrypted on the server and never sent back to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connection.connected ? (
            <div className="flex flex-wrap items-center gap-3">
              <Avatar className="size-9">
                {account?.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
                <AvatarFallback>{(account?.login ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {account?.htmlUrl ? (
                    <a className="underline-offset-2 hover:underline" href={account.htmlUrl} target="_blank" rel="noreferrer">
                      {account.login}
                    </a>
                  ) : (
                    (account?.login ?? "Connected")
                  )}
                  {account?.name ? <span className="font-normal text-muted-foreground"> · {account.name}</span> : null}
                </p>
                {account?.connectedAt ? (
                  <p className="text-xs text-muted-foreground">Connected {formatWhen(account.connectedAt)}</p>
                ) : null}
              </div>
              <StatusBadge tone="success" className="sm:ml-auto">
                Connected
              </StatusBadge>
            </div>
          ) : (
            <StatusBadge tone="neutral">Not connected</StatusBadge>
          )}
          {account && account.scopes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Scopes</span>
              {account.scopes.map((scope) => (
                <Badge key={scope} variant="outline" className="font-mono text-2xs">
                  {scope}
                </Badge>
              ))}
            </div>
          ) : null}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              aria-label="GitHub token"
              placeholder={connection.connected ? "Paste a new token to replace it" : "Paste a GitHub token"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button type="submit" disabled={saving || !token.trim()}>
              {connection.connected ? "Replace" : "Connect"}
            </Button>
            {connection.connected ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            ) : null}
          </form>
          <p className="text-xs text-muted-foreground">
            Create a token on{" "}
            <a
              className="underline underline-offset-2"
              href={tokenSettingsUrl(connection.webUrl)}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            . A classic token needs the <code>repo</code> scope, plus <code>admin:repo_hook</code> if Botanical should
            create webhooks for GitHub listeners. A fine-grained token needs Contents, Issues, and Pull requests (read
            and write), plus Webhooks for listeners.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What agents can do</CardTitle>
          <CardDescription>
            Add these tools to an agent's tool list. When the agent has roles, they also need the Git or GitHub
            capability.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium">Git</p>
            <p className="text-muted-foreground">
              Clone repositories into the agent's workspace, or start tracking files it made, then commit, switch
              branches, pull, and push. Files show in the chat's Files panel.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">GitHub</p>
            <p className="text-muted-foreground">
              List repositories, read, open, update, and comment on issues, and read and open pull requests.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="font-medium">Wake on GitHub events</p>
            <p className="text-muted-foreground">
              A GitHub listener starts the agent when an issue is opened, a comment is posted, or a pull request is
              opened. Create one on the Listeners page and connect it to a repository.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
