import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgentEditor } from '../components/agents/AgentEditor'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/primitives'
import { useWorkspace } from '../state/workspace'
import type { Agent } from '../lib/types'

export function AgentsScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { agents, saveAgent, removeAgent } = useWorkspace()
  const live = agents.find((a) => a.id === id) ?? null
  const [draft, setDraft] = useState<Agent | null>(live)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    setDraft(live)
  }, [live])

  useEffect(() => {
    if (!id && agents[0]) navigate(`/agents/${agents[0].id}`, { replace: true })
  }, [id, agents, navigate])

  async function onSave() {
    if (!draft) return
    setSaving(true)
    try {
      await saveAgent(draft)
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!draft) return
    await removeAgent(draft.id)
    setConfirm(false)
    const next = agents.find((a) => a.id !== draft.id)
    navigate(next ? `/agents/${next.id}` : '/agents')
  }

  return (
    <>
      <AgentEditor
        agent={draft}
        onChange={setDraft}
        onSave={() => void onSave()}
        onDelete={() => setConfirm(true)}
        saving={saving}
      />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete agent">
        <p className="text-[13.5px] text-mute">
          {draft?.name} will be removed from this workspace. Existing chats keep their history
          in v0 but cannot start new turns with a missing agent.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void onDelete()}>
            Delete
          </Button>
        </div>
      </Modal>
    </>
  )
}
