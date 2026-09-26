"use client";

import { useParams } from "next/navigation";
import { AgentEditorPage } from "@/components/agents/agent-editor-page";

export default function EditAgentPage() {
  const params = useParams<{ id: string }>();
  return <AgentEditorPage agentId={params.id} />;
}
