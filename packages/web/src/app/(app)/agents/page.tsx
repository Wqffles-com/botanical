import { EmptyState } from "@/components/chat/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AgentsPage() {
  return (
    <EmptyState
      title="Agents"
      body="Create and edit agents in the identity UI. Each chat still belongs to exactly one agent."
      action={
        <Button render={<Link href="/agents/new" />}>New agent</Button>
      }
    />
  );
}
