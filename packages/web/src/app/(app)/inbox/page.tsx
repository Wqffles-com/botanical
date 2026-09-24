import { EmptyState } from "@/components/chat/empty-state";

export default function InboxPage() {
  return (
    <EmptyState
      title="Inbox"
      body="Agent-to-agent messages will show up here. Chat stays one agent per thread."
    />
  );
}
