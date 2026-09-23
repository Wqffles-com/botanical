import { ALL_TOOLS } from '../../lib/store'
import type { Agent, ToolId } from '../../lib/types'
import { EmptyState } from '../ui/Modal'
import { Button, Chip, Field, Input, Textarea } from '../ui/primitives'

const COLORS = ['#8fca7a', '#7eb0c4', '#d4b07a', '#c4a0d4', '#e08b7a', '#e6d38a']

export function AgentEditor({
  agent,
  onChange,
  onSave,
  onDelete,
  saving,
}: {
  agent: Agent | null
  onChange: (agent: Agent) => void
  onSave: () => void
  onDelete: () => void
  saving: boolean
}) {
  if (!agent) {
    return (
      <EmptyState
        title="Agents"
        body="Unlimited custom agents. Each one has a prompt, a description, and a tool set. One agent owns each chat."
      />
    )
  }

  function toggleTool(id: ToolId) {
    const has = agent!.tools.includes(id)
    onChange({
      ...agent!,
      tools: has ? agent!.tools.filter((t) => t !== id) : [...agent!.tools, id],
    })
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl tracking-tight">{agent.name || 'Untitled agent'}</h1>
            <p className="mt-1 text-[13px] text-mute">Prompt and tools. Keys stay on the server.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button onClick={onSave} disabled={saving || !agent.name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-5">
          <Field label="Name">
            <Input
              value={agent.name}
              onChange={(e) => onChange({ ...agent, name: e.target.value })}
              placeholder="Greenhouse"
            />
          </Field>
          <Field label="Description" hint="Shown in pickers">
            <Input
              value={agent.description}
              onChange={(e) => onChange({ ...agent, description: e.target.value })}
              placeholder="What this agent is for"
            />
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => onChange({ ...agent, color: c })}
                  className="size-6 rounded-full border border-line"
                  style={{
                    background: c,
                    outline: agent.color === c ? '2px solid var(--color-ink)' : undefined,
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="System prompt">
            <Textarea
              value={agent.prompt}
              onChange={(e) => onChange({ ...agent, prompt: e.target.value })}
              rows={12}
              className="font-mono text-[13px] leading-relaxed"
            />
          </Field>
          <div>
            <div className="mb-2 text-[12.5px] font-medium text-mute">Tools</div>
            <div className="flex flex-wrap gap-2">
              {ALL_TOOLS.map((tool) => (
                <Chip
                  key={tool.id}
                  selected={agent.tools.includes(tool.id)}
                  onClick={() => toggleTool(tool.id)}
                >
                  {tool.label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-faint">
              Built-ins in v0: search, fetch, shell, files. MCP is opt-in. Browser/computer-use stays out of core.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
