import { useSession } from '../state/session'
import { DeploymentBadge } from '../components/settings/DeploymentBadge'
import { Button } from '../components/ui/primitives'
import { useNavigate } from 'react-router-dom'

export function SettingsScreen() {
  const { meta, profileId, logout, clearProfile } = useSession()
  const navigate = useNavigate()

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-6 py-10">
        <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-[13.5px] text-mute">
          v0 keeps this surface small. Keys, providers, and MCP live on the server.
        </p>

        <section className="mt-8 rounded-lg border border-line bg-panel p-4 hairline">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-medium">Deployment</h2>
              <p className="mt-1 text-[13px] text-mute">
                Same codebase for self-host and paid hosted. The client reads a mode flag — it
                never assumes SaaS.
              </p>
            </div>
            {meta ? <DeploymentBadge mode={meta.mode} large /> : null}
          </div>
          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-faint">Server</dt>
            <dd className="font-mono text-[12.5px]">{meta?.serverName ?? '—'}</dd>
            <dt className="text-faint">Version</dt>
            <dd className="font-mono text-[12.5px]">{meta?.version ?? '—'}</dd>
            <dt className="text-faint">Mode</dt>
            <dd className="font-mono text-[12.5px]">{meta?.mode ?? '—'}</dd>
          </dl>
        </section>

        <section className="mt-4 rounded-lg border border-line bg-panel p-4 hairline">
          <h2 className="text-[13px] font-medium">Session</h2>
          <p className="mt-1 text-[13px] text-mute">
            Active profile is required before chat. Clearing it returns you to the picker.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                clearProfile()
                navigate('/pick-profile')
              }}
            >
              Change profile
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void logout().then(() => navigate('/login'))
              }}
            >
              Sign out
            </Button>
          </div>
          <p className="mt-3 font-mono text-[12px] text-faint">
            profile: {profileId ?? 'none'}
          </p>
        </section>

        <section className="mt-4 rounded-lg border border-dashed border-line p-4">
          <h2 className="text-[13px] font-medium text-mute">Not in this client</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-faint">
            <li>Provider API keys (server env only)</li>
            <li>MCP server install</li>
            <li>Billing — SaaS mode will add this later</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
