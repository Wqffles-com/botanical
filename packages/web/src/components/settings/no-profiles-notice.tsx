"use client";

import { useEffect, useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { useAppDialogs } from "@/components/app-dialogs";
import { api } from "@/lib/api";

const PROVIDERS = "OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, or an OpenAI-compatible endpoint";

/** Whether the signed-in user can set global provider keys (Settings → Admin). */
export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void api
      .me()
      .then((me) => !cancelled && setAdmin(me.user?.role === "admin"))
      .catch(() => !cancelled && setAdmin(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return admin;
}

/** Empty state for a missing model profile: says where a provider key is added and opens it. */
export function NoProfilesNotice() {
  const { openSettings } = useAppDialogs();
  const admin = useIsAdmin();
  return (
    <div data-testid="no-profiles" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">No model yet</p>
        <p className="text-sm text-muted-foreground">
          {admin
            ? `Add a provider key (${PROVIDERS}) under Admin, then pick a model.`
            : "A provider key has to be set first. Ask an admin to add one under Settings → Admin."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => openSettings(admin ? "admin" : "profiles")}>
        {admin ? "Add a provider key" : "See providers"}
      </Button>
    </div>
  );
}
