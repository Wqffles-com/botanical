"use client";

import { pageContainerVariants } from "@botanical/ui/components/page-container";
import type { ModelProfile } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import {
  Brain,
  GitBranch,
  Layers,
  Plug,
  Server,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  UserCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { PageHeader } from "@botanical/ui/components/page-header";
import { Badge } from "@botanical/ui/components/badge";
import { StatusBadge } from "@botanical/ui/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@botanical/ui/components/tabs";
import { api } from "@/lib/api";
import { providerLabel } from "@/lib/format-extra";
import { useWorkspace } from "@/components/workspace-provider";
import { cn } from "@/lib/utils";
import { CliPanel } from "@/components/settings/cli-panel";
import { GithubPanel } from "@/components/settings/github-panel";
import { MemoryPanel } from "@/components/settings/memory-panel";
import { ProfilesPanel } from "@/components/settings/profiles-panel";
import { RolesPanel } from "@/components/settings/roles-panel";
import { fetchMcpServers, fetchProfiles, fetchSettings, fetchTools } from "@/lib/mvp-api";
import type { AppSettings, CatalogTool, McpSnapshot, ProviderKeyStatus } from "@/lib/mvp-types";
import { deriveProviderKeys } from "@/lib/parse";
import { AccentCard } from "./accent-card";
import { AccountCard } from "./account-card";
import { AdminPanel } from "./admin-panel";
import { BackgroundWorkCard } from "./background-work-card";
import { DeploymentBadge } from "./deployment-badge";

export type SettingsTab = "general" | "profiles" | "memory" | "roles" | "cli" | "github" | "admin";

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string; icon: LucideIcon }> = [
  { value: "general", label: "General", icon: Settings2 },
  { value: "profiles", label: "Profiles", icon: Layers },
  { value: "memory", label: "Memory", icon: Brain },
  { value: "roles", label: "Roles & permissions", icon: ShieldCheck },
  { value: "cli", label: "Coding CLIs", icon: SquareTerminal },
  { value: "github", label: "GitHub", icon: GitBranch },
  { value: "admin", label: "Admin", icon: UserCog },
];

export function normalizeSettingsTab(value: string | null | undefined): SettingsTab {
  if (
    value === "profiles" ||
    value === "memory" ||
    value === "roles" ||
    value === "cli" ||
    value === "github" ||
    value === "admin"
  ) {
    return value;
  }
  return "general";
}

/** `/settings` fallback page. In the app, settings open as a dialog (`useAppDialogs().openSettings`). */
export function SettingsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = normalizeSettingsTab(searchParams.get("tab"));

  function selectTab(value: SettingsTab) {
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
      <SettingsPanels tab={tab} onTab={selectTab} layout="page" />
    </div>
  );
}

/**
 * Every settings section. `page` lays the tabs out on top; `dialog` puts them in a rail on the
 * left with the section scrolling beside it.
 */
export function SettingsPanels({
  tab,
  onTab,
  layout,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  layout: "page" | "dialog";
}) {
  const router = useRouter();
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

  const visibleTabs = SETTINGS_TABS.filter((item) => admin || item.value !== "admin");

  const providers = useMemo(
    () => deriveProviderKeys(profiles, settings?.providers ?? []),
    [profiles, settings],
  );

  const dialog = layout === "dialog";
  const selectTab = (next: unknown) => onTab(normalizeSettingsTab(typeof next === "string" ? next : null));

  // The tabs do not fit a phone, so pick the section from a select below sm.
  const mobilePicker = (
    <Select items={visibleTabs} value={tab} onValueChange={(value) => value && selectTab(value)}>
      <SelectTrigger className="w-full sm:hidden" aria-label="Settings section">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {visibleTabs.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const errorLine = error ? (
    <p role="alert" className={cn("text-sm text-destructive", dialog ? "mb-4" : "mt-6")}>
      {error}
    </p>
  ) : null;

  const panels = (
    <>
      <TabsContent value="general" className={cn("space-y-4", !dialog && "mt-4")}>
        <AccountCard />
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
      <TabsContent value="profiles" className={cn(!dialog && "mt-4")}>
        {loading ? <SettingsSkeleton /> : <ProfilesPanel profiles={profiles} admin={admin} onAddKey={() => onTab("admin")} />}
      </TabsContent>
      <TabsContent value="memory" className={cn(!dialog && "mt-4")}>
        <MemoryPanel agents={agents} />
      </TabsContent>
      <TabsContent value="roles" className={cn(!dialog && "mt-4")}>
        <RolesPanel agents={agents} onAgentsChanged={refresh} />
      </TabsContent>
      <TabsContent value="cli" className={cn(!dialog && "mt-4")}>
        <CliPanel />
      </TabsContent>
      <TabsContent value="github" className={cn(!dialog && "mt-4")}>
        <GithubPanel />
      </TabsContent>
      {admin ? (
        <TabsContent value="admin" className={cn(!dialog && "mt-4")}>
          <AdminPanel />
        </TabsContent>
      ) : null}
    </>
  );

  if (dialog) {
    return (
      <Tabs
        value={tab}
        onValueChange={selectTab}
        orientation="vertical"
        className="h-full min-h-0 flex-col gap-0 sm:flex-row"
      >
        <nav className="flex shrink-0 flex-col gap-3 border-b p-3 sm:w-56 sm:border-r sm:border-b-0 sm:p-4">
          {mobilePicker}
          <TabsList variant="line" className="hidden w-full items-stretch gap-0.5 sm:flex">
            {visibleTabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-9 flex-none justify-start gap-2.5 rounded-lg px-2.5 after:hidden data-active:bg-accent! data-active:text-foreground"
              >
                <Icon />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {errorLine}
          {panels}
        </div>
      </Tabs>
    );
  }

  return (
    <>
      {errorLine}
      <Tabs value={tab} onValueChange={selectTab} className="mt-8">
        {mobilePicker}
        <TabsList
          variant="line"
          className="scrollbar-thin hidden w-full justify-start gap-4 overflow-x-auto overflow-y-hidden border-b px-0 group-data-horizontal/tabs:h-10 sm:flex"
        >
          {visibleTabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="flex-none px-0.5">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {panels}
      </Tabs>
    </>
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
          body="The server only lists profiles whose provider key is set. Set a key and reload."
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
