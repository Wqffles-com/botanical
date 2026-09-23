import type { Agent } from "@botanical/core";

export function AgentPicker({
  agents,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}) {
  return (
    <fieldset className="bc-agents">
      <legend>Agent</legend>
      {agents.length === 0 ? <p className="bc-muted">Create an agent to start a chat.</p> : null}
      <div className="bc-agent-list" role="radiogroup" aria-label="Agent">
        {agents.map((agent) => {
          const selected = agent.id === selectedId;
          return (
            <label key={agent.id} className={selected ? "bc-agent is-selected" : "bc-agent"}>
              <input
                type="radio"
                name="owning-agent"
                data-testid="agent-option"
                value={agent.id}
                checked={selected}
                onChange={() => onSelect(agent.id)}
              />
              <span className="bc-agent-name">{agent.name}</span>
              {agent.description ? <small className="bc-agent-desc">{agent.description}</small> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
