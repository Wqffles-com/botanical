"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { me } = useWorkspace();
  const [pending, setPending] = useState(false);
  const mode = me?.mode ?? null;

  async function onLogout() {
    setPending(true);
    try {
      await api.logout();
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <PageHeader
        title="Settings"
        description="v0 keeps this surface small. Keys, providers, and MCP live on the server."
      />
      <Tabs defaultValue="profiles" className="mt-8">
        <TabsList>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Model profiles</CardTitle>
              <CardDescription>
                Only providers with a server-side key appear, plus mock. There is no silent default.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Profile list lands in the settings UI.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="tools">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Tools</CardTitle>
              <CardDescription>Built-ins and MCP tools from GET /api/tools.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Tool catalog lands in the settings UI.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mcp">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>MCP servers</CardTitle>
              <CardDescription>Configured servers and status from GET /api/mcp/servers.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">MCP status lands in the settings UI.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="deployment">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Deployment</CardTitle>
              <CardDescription>Same codebase for self-host and hosted. The client only reads a flag.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex items-center gap-2">
                <Badge variant={mode === "SAAS" ? "secondary" : "default"}>
                  {mode === "SAAS" ? "SaaS" : "Self-host"}
                </Badge>
                <span className="text-sm text-muted-foreground">{me?.brandName ?? "Botanical"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void onLogout()} disabled={pending}>
                  Sign out
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
