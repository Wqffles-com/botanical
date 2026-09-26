"use client";

import { useCallback, useEffect, useState } from "react";
import { listAgents } from "@/lib/agent-api";
import type { AgentIdentity } from "@/lib/agent-identity";

export function useAgents() {
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAgents();
      setAgents(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { agents, loading, error, reload };
}
