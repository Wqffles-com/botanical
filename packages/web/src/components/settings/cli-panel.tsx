"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelCliLogin,
  fetchCliList,
  fetchCliLogin,
  installCli,
  sendCliLoginInput,
  startCliLogin,
  type CliId,
  type CliLogin,
  type CliRow,
} from "@/lib/cli-api";

const TERMINAL: Record<CliId, string> = {
  grok: "docker compose exec -u botanical server grok login --device-auth",
  codex: "docker compose exec -u botanical server codex login --device-auth",
  claude: "docker compose exec -it -u botanical server claude setup-token",
};

export function CliPanel() {
  const [rows, setRows] = useState<CliRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [login, setLogin] = useState<CliLogin | null>(null);
  const [paste, setPaste] = useState("");

  const load = useCallback(async () => {
    const next = await fetchCliList();
    setRows(next);
    setError(null);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCliList()
      .then((next) => {
        if (cancelled) return;
        setRows(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load coding CLIs.");
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!rows?.some((row) => row.status === "installing") && login?.state !== "pending" && login?.state !== "needs_input") {
      return;
    }
    const timer = setInterval(() => {
      void load().catch(() => undefined);
      if (login && (login.state === "pending" || login.state === "needs_input")) {
        void fetchCliLogin(login.cli)
          .then((next) => {
            setLogin(next);
            if (next.state === "done") {
              toast.success("Signed in.");
              void load();
            }
          })
          .catch(() => undefined);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [rows, login, load]);

  async function onInstall(row: CliRow) {
    setBusy(`${row.cli}:install`);
    setRows((current) => current?.map((item) => (item.cli === row.cli ? { ...item, status: "installing" } : item)) ?? current);
    try {
      const next = await installCli(row.cli, row.status === "installed");
      setRows((current) => current?.map((item) => (item.cli === next.cli ? next : item)) ?? [next]);
      if (next.status === "failed") toast.error(next.lastError ?? "Install failed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed.");
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function onLogin(row: CliRow) {
    setBusy(`${row.cli}:login`);
    setPaste("");
    try {
      setLogin(await startCliLogin(row.cli));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start login.");
    } finally {
      setBusy(null);
    }
  }

  async function onCancel(cli: CliId) {
    setBusy(`${cli}:cancel`);
    try {
      setLogin(await cancelCliLogin(cli));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel login.");
    } finally {
      setBusy(null);
    }
  }

  async function onPaste(cli: CliId) {
    const value = paste.trim();
    if (!value) return;
    setBusy(`${cli}:input`);
    try {
      const next = await sendCliLoginInput(cli, value);
      setPaste("");
      setLogin(next);
      if (next.state === "done") {
        toast.success("Signed in.");
        await load();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send that to the CLI.");
    } finally {
      setBusy(null);
    }
  }

  if (rows === null && !error) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {rows && rows.length === 0 ? (
        <EmptyState
          title="No coding CLIs enabled"
          body="Set BOTANICAL_CLI_PROFILES to grok-build, claude-code, or codex (comma-separated) and recreate the server container. Then install and sign in here."
          className="min-h-40 rounded-xl border border-dashed"
        />
      ) : (
        rows?.map((row) => (
          <Card key={row.cli}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {row.label}
                <StatusBadge row={row} />
                <LoginBadge loggedIn={row.loggedIn} />
              </CardTitle>
              <CardDescription className="font-mono text-[12px]">
                {row.cli}
                {row.arch ? ` · ${row.arch}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {row.lastError ? <p className="text-sm text-muted-foreground">{row.lastError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void onInstall(row)} disabled={busy !== null || row.status === "installing"}>
                  {row.status === "installing" ? "Installing…" : row.status === "installed" ? "Update" : "Install"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onLogin(row)}
                  disabled={busy !== null || row.status !== "installed"}
                >
                  Log in
                </Button>
                {login?.cli === row.cli && (login.state === "pending" || login.state === "needs_input") ? (
                  <Button size="sm" variant="outline" onClick={() => void onCancel(row.cli)} disabled={busy !== null}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {login?.cli === row.cli ? <LoginPanel login={login} paste={paste} setPaste={setPaste} onPaste={() => void onPaste(row.cli)} busy={busy !== null} /> : null}
            </CardContent>
          </Card>
        ))
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Terminal fallback</CardTitle>
          <CardDescription>
            The same commands run inside the server container. Claude prints a token and does not save it; paste that token above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(Object.keys(TERMINAL) as CliId[]).map((cli) => (
            <div key={cli} className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{TERMINAL[cli]}</code>
              <Button size="sm" variant="outline" onClick={() => void copy(TERMINAL[cli])}>
                Copy
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function LoginPanel({
  login,
  paste,
  setPaste,
  onPaste,
  busy,
}: {
  login: CliLogin;
  paste: string;
  setPaste: (value: string) => void;
  onPaste: () => void;
  busy: boolean;
}) {
  const waiting = login.state === "pending" || login.state === "needs_input";
  const showPaste = waiting && (login.cli === "claude" || login.state === "needs_input" || Boolean(login.prompt));
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        {login.state === "done"
          ? "Signed in."
          : login.state === "expired"
            ? "Login expired."
            : login.state === "cancelled"
              ? "Login cancelled."
              : login.state === "failed"
                ? login.error ?? "Login failed."
                : login.state === "needs_input"
                  ? "Waiting for input."
                  : "Waiting for you to finish in the browser."}
      </p>
      {login.verificationUrl ? (
        <a href={login.verificationUrl} target="_blank" rel="noreferrer" className="block break-all text-sm underline underline-offset-4">
          {login.verificationUrl}
        </a>
      ) : null}
      {login.userCode ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{login.userCode}</span>
          <Button size="sm" variant="outline" onClick={() => void copy(login.userCode ?? "")}>
            Copy code
          </Button>
        </div>
      ) : null}
      {login.prompt ? <p className="text-sm text-muted-foreground">{login.prompt}</p> : null}
      {showPaste ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onPaste();
          }}
        >
          <Input
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder={login.cli === "claude" ? "Paste token" : "Paste code"}
            type={login.cli === "claude" ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            className="max-w-md font-mono"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || paste.trim() === ""}>
            Submit
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function StatusBadge({ row }: { row: CliRow }) {
  if (row.status === "installed") return <Badge variant="secondary">Installed{row.version ? ` v${row.version}` : ""}</Badge>;
  if (row.status === "installing") return <Badge variant="outline">Installing…</Badge>;
  if (row.status === "failed") return <Badge variant="outline">Failed</Badge>;
  return <Badge variant="outline">Not installed</Badge>;
}

function LoginBadge({ loggedIn }: { loggedIn: CliRow["loggedIn"] }) {
  if (loggedIn === true) return <Badge>Logged in</Badge>;
  if (loggedIn === false) return <Badge variant="outline">Not logged in</Badge>;
  return <Badge variant="outline">Login unknown</Badge>;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied.");
  } catch {
    toast.error("Could not copy.");
  }
}
