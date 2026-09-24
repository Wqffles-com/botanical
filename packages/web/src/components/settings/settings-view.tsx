"use client";

import type { ModelProfile } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { Plug, Server, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { providerLabel } from "@/lib/format-extra";
import { fetchMcpServers, fetchProfiles, fetchSettings, fetchTools } from "@/lib/mvp-api";
import type { AppSettings, CatalogTool, McpSnapshot, ProviderKeyStatus } from "@/lib/mvp-types";
import { deriveProviderKeys } from "@/lib/parse";
import { DeploymentBadge } from "./deployment-badge";

export function SettingsView() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [tools, setTools] = useState<CatalogTool[]>([]);
  const [mcp, setMcp] = useState<McpSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchProfiles(), fetchTools(), fetchMcpServers(), fetchSettings()])
      .then(([nextProfiles, nextTools, nextServers, nextSettings]) => {
        if (cancelled) return;
        setProfiles(nextProfiles);
        setTools(nextTools);
        setMcp(nextServers);
        setSettings(nextSettings);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load settings.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const providers = useMemo(
    () => deriveProviderKeys(profiles, settings?.providers ?? []),
    [profiles, settings],
  );

  async function onSignOut() {
    setSigningOut(true);
    try {
      await api.logout();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign out.");
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader
        title="Settings"
        description="Profiles, tools, and MCP live on the server. Keys never enter this browser."
        actions={
          <Button variant="outline" onClick={() => void onSignOut()} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Tabs defaultValue="profiles" className="mt-8">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          {loading ? <SettingsSkeleton /> : <ProfilesTab profiles={profiles} providers={providers} />}
        </TabsContent>
        <TabsContent value="tools" className="mt-4">
          {loading ? <SettingsSkeleton /> : <ToolsTab tools={tools} />}
        </TabsContent>
        <TabsContent value="mcp" className="mt-4">
          {loading ? <SettingsSkeleton /> : <McpTab snapshot={mcp} />}
        </TabsContent>
        <TabsContent value="deployment" className="mt-4">
          {loading ? <SettingsSkeleton /> : <DeploymentTab settings={settings} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfilesTab({
  profiles,
  providers,
}: {
  profiles: ModelProfile[];
  providers: ProviderKeyStatus[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Provider keys</CardTitle>
          <CardDescription>
            Configured on the host via environment variables. Mock is always available.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {providers.map((provider) => (
            <Badge key={provider.id} variant={provider.configured ? "default" : "outline"}>
              {provider.label}
              <span className="ml-1.5 font-normal opacity-80">
                {provider.configured ? "key set" : "missing"}
              </span>
            </Badge>
          ))}
        </CardContent>
      </Card>
      {profiles.length === 0 ? (
        <EmptyState
          title="No model profiles"
          body="The server only lists profiles whose provider key is set, plus mock. Set a key and reload."
          className="min-h-40 rounded-xl border border-dashed"
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardHeader className="pb-2">
                <CardTitle>{profile.name}</CardTitle>
                <CardDescription>{profile.description ?? "Operator-configured profile."}</CardDescription>
              </CardHeader>
              <CardContent className="font-mono text-[11.5px] text-muted-foreground">
                {providerLabel(profile.provider)} · {profile.model}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolsTab({ tools }: { tools: CatalogTool[] }) {
  const builtins = tools.filter((tool) => tool.source === "builtin");
  const mcp = tools.filter((tool) => tool.source === "mcp");
  if (tools.length === 0) {
    return (
      <EmptyState
        title="No tools advertised"
        body="GET /api/tools is empty or not implemented yet. Built-ins and MCP tools will show here with their source."
        className="min-h-40 rounded-xl border border-dashed"
      />
    );
  }
  return (
    <div className="space-y-4">
      <ToolGroup title="Built-ins" icon={Wrench} tools={builtins} empty="No built-in tools in the catalog." />
      <ToolGroup title="MCP tools" icon={Plug} tools={mcp} empty="No MCP tools connected." />
    </div>
  );
}

function ToolGroup({
  title,
  icon: Icon,
  tools,
  empty,
}: {
  title: string;
  icon: typeof Wrench;
  tools: CatalogTool[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
          <Badge variant="secondary">{tools.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tools.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
        {tools.map((tool) => (
          <div key={tool.id || tool.name} className="rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px]">{tool.name}</span>
              <Badge variant="outline">{tool.source}</Badge>
              {tool.serverId ? <Badge variant="secondary">{tool.serverId}</Badge> : null}
              {tool.risk ? <Badge variant="outline">{tool.risk}</Badge> : null}
            </div>
            {tool.description ? (
              <p className="mt-1 text-[13px] text-muted-foreground">{tool.description}</p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function McpTab({ snapshot }: { snapshot: McpSnapshot | null }) {
  const servers = snapshot?.servers ?? [];
  if (servers.length === 0) {
    return (
      <EmptyState
        title={snapshot?.disabled ? "MCP is disabled" : "No MCP servers"}
        body={
          snapshot?.configError ??
          "GET /api/mcp/servers will list configured servers and their status once the MCP agent lands."
        }
        className="min-h-40 rounded-xl border border-dashed"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {snapshot?.configError ? (
        <p className="text-sm text-destructive">{snapshot.configError}</p>
      ) : null}
      {servers.map((server) => (
        <Card key={server.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4" />
              {server.serverName ?? server.id}
              <McpStateBadge state={server.state} />
            </CardTitle>
            <CardDescription className="font-mono">
              {server.id} · {server.transport} · {server.toolCount} tools
            </CardDescription>
          </CardHeader>
          {server.error ? (
            <CardContent className="text-sm text-destructive">{server.error}</CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function McpStateBadge({ state }: { state: string }) {
  const variant = state === "ready" ? "default" : state === "error" ? "destructive" : "secondary";
  return <Badge variant={variant}>{state}</Badge>;
}

function DeploymentTab({ settings }: { settings: AppSettings | null }) {
  const mode = settings?.deploymentMode ?? null;
  const flags = settings?.features ?? {};
  const flagEntries = Object.entries(flags);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Deployment</CardTitle>
            <CardDescription>
              Same codebase for self-host and hosted SaaS. The client reads a mode flag.
            </CardDescription>
          </div>
          <DeploymentBadge mode={mode} large />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Brand</dt>
          <dd className="font-mono text-[12.5px]">{settings?.brandName ?? "—"}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-[12.5px]">{settings?.version ?? "—"}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd className="font-mono text-[12.5px]">{mode ?? "—"}</dd>
        </dl>
        {flagEntries.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {flagEntries.map(([key, value]) => (
              <Badge key={key} variant={value ? "default" : "outline"}>
                {key}: {String(value)}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
