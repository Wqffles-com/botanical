import { Mark } from "./Mark";

export function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="bc-empty">
      <div className="bc-column bc-empty-card">
        <Mark size={36} />
        <h2>Start a chat</h2>
        <p>Choose one agent and a model profile. Each chat stays with that agent.</p>
        <button type="button" className="bc-button" onClick={onNew}>
          New chat
        </button>
      </div>
    </div>
  );
}
