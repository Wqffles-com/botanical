import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { listProfiles } from '../lib/api'
import type { Profile } from '../lib/types'
import { useSession } from '../state/session'
import { ProfileGrid } from '../components/profiles/ProfilePicker'
import { Mark } from '../components/ui/Logo'
import { Button } from '../components/ui/primitives'

export function ProfileGateScreen() {
  const { token, profileId, setProfileId } = useSession()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [picked, setPicked] = useState<string | null>(profileId)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listProfiles()
      .then(setProfiles)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        const profile = profiles[idx]
        if (profile) setPicked(profile.id)
      }
      if (e.key === 'Enter' && picked) {
        setProfileId(picked)
        navigate('/chats')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profiles, picked, setProfileId, navigate])

  if (!token) return <Navigate to="/login" replace />
  if (profileId) return <Navigate to="/chats" replace />

  function confirm() {
    if (!picked) return
    setProfileId(picked)
    navigate('/chats')
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <Mark className="size-9" />
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Choose a profile</h1>
          <p className="text-[13.5px] text-mute">
            Required. Botanical never silently picks a model.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-mute">Loading profiles…</p>
      ) : (
        <ProfileGrid profiles={profiles} selectedId={picked} onSelect={setPicked} />
      )}
      <div className="mt-8 flex items-center justify-between">
        <p className="text-[12px] text-faint">Keys 1–9 select · Enter confirms</p>
        <Button disabled={!picked} onClick={confirm}>
          Use this profile
        </Button>
      </div>
    </div>
  )
}
