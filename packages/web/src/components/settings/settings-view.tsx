"use client";

import { pageContainerVariants } from "@botanical/ui/components/page-container";
import type { ModelProfile } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { Layers, Plug, Server, Wrench } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { PageHeader } from "@botanical/ui/components/page-header";
import { Badge } from "@botanical/ui/components/badge";
import { StatusBadge } from "@botanical/ui/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@botanical/ui/components/tabs";
import { api } from "@/lib/api";
import { providerLabel } from "@/lib/format-extra";
import { useWorkspace } from "@/components/workspace-provider";
import { CliPanel } from "@/components/settings/cli-panel";
import { MemoryPanel } from "@/components/settings/memory-panel";
import { ProfilesPanel } from "@/components/settings/profiles-panel";
import { RolesPanel } from "@/components/settings/roles-panel";
import { fetchMcpServers, fetchProfiles, fetchSettings, fetchTools } from "@/lib/mvp-api";
import type { AppSettings, CatalogTool, McpSnapshot, ProviderKeyStatus } from "@/lib/mvp-types";
import { deriveProviderKeys } from "@/lib/parse";
import { AccentCard } from "./accent-card";
import { AdminPanel } from "./admin-panel";
import { BackgroundWorkCard } from "./background-work-card";
import { DeploymentBadge } from "./deployment-badge";

type SettingsTab = "general" | "profiles" | "memory" | "roles" | "cli" | "admin";

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "general", label: "General" },
  { value: "profiles", label: "Profiles" },
  { value: "memory", label: "Memory" },
  { value: "roles", label: "Roles & permissions" },
  { value: "cli", label: "Coding CLIs" },
  { value: "admin", label: "Admin" },
];

function normalizeTab(value: string | null): SettingsTab {
  if (value === "profiles" || value === "memory" || value === "roles" || value === "cli" || value === "admin") return value;
  return "general";
}

export function SettingsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = normalizeTab(searchParams.get("tab"));
  const { agents, refresh } = useWorkspace();
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [tools, setTools] = useState<CatalogTool[]>([]);
  const [mcp, setMcp] = useState<McpSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    void api.me().then((me) => setAdmin(me.user?.role === "admin")).catch(() => setAdmin(false));
  }, []);

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

  function selectTab(next: string) {
    const value = normalizeTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (value === "general") params.delete("tab");
    else params.set("tab", value);
    const query = params.toString();
    router.replace(query ? `/settings?${query}` : "/settings", { scroll: false });
  }

  return (
    <div className={pageContainerVariants()}>
      <PageHeader
        title="Settings"
        description="Profiles, memory, and roles live on the server. Keys never enter this browser."
      />

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={selectTab} className="mt-8">
        <TabsList
          variant="line"
          className="scrollbar-thin w-full justify-start gap-4 overflow-x-auto overflow-y-hidden border-b px-0 group-data-horizontal/tabs:h-10"
        >
          {SETTINGS_TABS.filter((item) => admin || item.value !== "admin").map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="flex-none px-0.5">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <AccentCard />
          {loading ? (
            <SettingsSkeleton />
          ) : (
            <>
              <DeploymentTab settings={settings} />
              <BackgroundWorkCard />
              <ProfilesTab profiles={[]} providers={providers} keysOnly />
              <ToolsTab tools={tools} />
              <McpTab snapshot={mcp} />
            </>
          )}
        </TabsContent>
        <TabsContent value="profiles" className="mt-4">
          {loading ? <SettingsSkeleton /> : <ProfilesPanel profiles={profiles} />}
        </TabsContent>
        <TabsContent value="memory" className="mt-4">
          <MemoryPanel agents={agents} />
        </TabsContent>
        <TabsContent value="roles" className="mt-4">
          <RolesPanel agents={agents} onAgentsChanged={refresh} />
        </TabsContent>
        <TabsContent value="cli" className="mt-4">
          <CliPanel />
        </TabsContent>
        {admin ? (
          <TabsContent value="admin" className="mt-4">
            <AdminPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function ProfilesTab({
  profiles,
  providers,
  keysOnly = false,
}: {
  profiles: ModelProfile[];
  providers: ProviderKeyStatus[];
  keysOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Provider keys</CardTitle>
          <CardDescription>
            Global keys are set by an admin. A personal key overrides the global one. Keys are write-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {providers.map((provider) => (
            <StatusBadge key={provider.id} tone={provider.configured ? "success" : "neutral"}>
              {provider.label}
              <span className="font-normal opacity-80">{provider.configured ? "key set" : "no key"}</span>
            </StatusBadge>
          ))}
        </CardContent>
      </Card>
      {keysOnly ? null : profiles.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No model profiles"
          body="The server only lists profiles whose provider key is set, plus mock. Set a key and reload."
          bordered
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardHeader className="pb-2">
                <CardTitle>{profile.name}</CardTitle>
                <CardDescription>{profile.description ?? "Operator-configured profile."}</CardDescription>
              </CardHeader>
              <CardContent className="font-mono text-2xs text-muted-foreground">
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
        icon={Wrench}
        title="No tools advertised"
        body="GET /api/tools is empty or not implemented yet. Built-ins and MCP tools will show here with their source."
        bordered
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
              <span className="font-mono text-sm">{tool.name}</span>
              <Badge variant="outline">{tool.source}</Badge>
              {tool.serverId ? <Badge variant="secondary">{tool.serverId}</Badge> : null}
              {tool.risk ? <Badge variant="outline">{tool.risk}</Badge> : null}
            </div>
            {tool.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
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
        icon={Plug}
        title={snapshot?.disabled ? "MCP is disabled" : "No MCP servers"}
        body={
          snapshot?.configError ??
          "GET /api/mcp/servers will list configured servers and their status once the MCP agent lands."
        }
        bordered
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
  const tone = state === "ready" ? "success" : state === "error" ? "danger" : "neutral";
  return (
    <StatusBadge tone={tone} className="capitalize">
      {state}
    </StatusBadge>
  );
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
          <dd className="font-mono text-xs">{settings?.brandName ?? "—"}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-xs">{settings?.version ?? "—"}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd className="font-mono text-xs">{mode ?? "—"}</dd>
        </dl>
        {flagEntries.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {flagEntries.map(([key, value]) => (
              <StatusBadge key={key} tone={value ? "success" : "neutral"}>
                {key}: {String(value)}
              </StatusBadge>
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
