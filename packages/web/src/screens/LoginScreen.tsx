import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useSession } from '../state/session'
import { Mark, Wordmark } from '../components/ui/Logo'
import { Button, Input } from '../components/ui/primitives'
import { DeploymentBadge } from '../components/settings/DeploymentBadge'

export function LoginScreen() {
  const { token, ready, login, meta } = useSession()
  const navigate = useNavigate()
  const [passcode, setPasscode] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.getElementById('passcode')?.focus()
  }, [])

  if (ready && token) return <Navigate to="/chats" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(passcode)
      navigate('/pick-profile')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4">
      <div className="login-orb -top-24 left-1/2 -translate-x-1/2" />
      <Vines />
      <div className="relative w-full max-w-[380px] fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Mark className="size-12" />
          <Wordmark className="mt-4 text-[2.4rem]" />
          <p className="mt-2 text-[14px] text-mute">Personal agent server. Any brain.</p>
        </div>
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-xl border border-line bg-panel/90 p-5 hairline backdrop-blur-sm"
        >
          <label htmlFor="passcode" className="text-[12.5px] font-medium text-mute">
            Passcode
          </label>
          <div className="relative mt-1.5">
            <Input
              id="passcode"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Server passcode"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              aria-label={show ? 'Hide passcode' : 'Show passcode'}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error ? <p className="mt-2 text-[12.5px] text-rose">{error}</p> : null}
          <Button type="submit" className="mt-4 w-full" disabled={busy || passcode.trim().length < 4}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
          <p className="mt-3 text-[12px] text-faint">
            Web → server only. Model keys never leave the host.
          </p>
        </form>
        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-faint">
          {meta ? <DeploymentBadge mode={meta.mode} /> : null}
          <span>{meta?.serverName ?? 'botanical'}</span>
        </div>
      </div>
    </div>
  )
}

function Vines() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22]"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g fill="none" stroke="#8fca7a" strokeLinecap="round">
        <path d="M90 800C110 560 40 480 120 300c70-160-20-240 40-300" strokeWidth="1.1" />
        <path d="M1110 800c-40-220 70-300-20-470-80-150 30-230-10-330" strokeWidth="1.1" />
        <path d="M90 420c-50 10-70 70-40 90" strokeWidth="0.9" />
        <path d="M120 300c40-8 62 40 28 58" strokeWidth="0.9" />
        <path d="M1110 430c48 12 70 64 30 86" strokeWidth="0.9" />
        <path d="M1088 280c-44-10-60 38-24 56" strokeWidth="0.9" />
      </g>
    </svg>
  )
}
