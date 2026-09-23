import type { Agent, CreateAgentInput, ModelProfile } from "@botanical/core";
import type { NewChatDraft } from "../state/model";
import { canStartChat } from "../state/model";
import { AgentForm } from "./AgentForm";
import { AgentPicker } from "./AgentPicker";
import { ProfileSelect } from "./ProfileSelect";

export function NewChatPanel({
  agents,
  profiles,
  draft,
  pending,
  agentPending,
  onSelectAgent,
  onSelectProfile,
  onTitle,
  onCreateAgent,
  onSubmit,
  onCancel,
}: {
  agents: Agent[];
  profiles: ModelProfile[];
  draft: NewChatDraft;
  pending: boolean;
  agentPending: boolean;
  onSelectAgent: (agentId: string) => void;
  onSelectProfile: (profileId: string | null) => void;
  onTitle: (title: string) => void;
  onCreateAgent: (input: CreateAgentInput) => Promise<boolean>;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ready = canStartChat(draft);
  return (
    <div className="bc-newchat">
      <div className="bc-column">
        <header className="bc-newchat-head">
          <h2>New chat</h2>
          <p>Each chat belongs to one agent and runs on the model profile you choose.</p>
        </header>
        <AgentPicker agents={agents} selectedId={draft.agentId} onSelect={onSelectAgent} />
        <AgentForm pending={agentPending} forceOpen={agents.length === 0} onCreate={onCreateAgent} />
        <form
          className="bc-newchat-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || pending) return;
            onSubmit();
          }}
        >
          <ProfileSelect id="new-chat-profile" profiles={profiles} value={draft.profileId} onChange={onSelectProfile} />
          {profiles.length === 0 ? (
            <p className="bc-muted">Add a model profile on the server, then refresh.</p>
          ) : null}
          <label className="bc-field">
            <span>Title</span>
            <input
              value={draft.title}
              placeholder="Optional"
              onChange={(event) => onTitle(event.target.value)}
            />
          </label>
          <div className="bc-row">
            <button className="bc-button" type="submit" data-testid="start-chat" disabled={!ready || pending}>
              {pending ? "Starting…" : "Start chat"}
            </button>
            <button className="bc-button bc-button--quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
          <ul className="bc-requirements">
            <li className={draft.agentId ? "is-met" : undefined}>Choose one agent for this chat.</li>
            <li className={draft.profileId ? "is-met" : undefined}>Choose a model profile for this chat.</li>
          </ul>
        </form>
      </div>
    </div>
  );
}
