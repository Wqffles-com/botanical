import { EmptyState } from "@/components/chat/empty-state";

export default function NewAgentPage() {
  return (
    <EmptyState
      title="New agent"
      body="The agent identity form lands in a sibling PR. You still pick one agent when starting a chat."
    />
  );
}
