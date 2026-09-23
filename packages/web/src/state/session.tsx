import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getMeta, login as apiLogin, logout as apiLogout } from '../lib/api'
import type { ServerMeta } from '../lib/types'

const TOKEN_KEY = 'botanical.token'
const PROFILE_KEY = 'botanical.profileId'

interface SessionValue {
  token: string | null
  profileId: string | null
  meta: ServerMeta | null
  ready: boolean
  login: (passcode: string) => Promise<void>
  logout: () => Promise<void>
  setProfileId: (id: string) => void
  clearProfile: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [profileId, setProfileIdState] = useState<string | null>(() =>
    localStorage.getItem(PROFILE_KEY),
  )
  const [meta, setMeta] = useState<ServerMeta | null>(null)
  const ready = true

  useEffect(() => {
    let cancelled = false
    getMeta()
      .then((m) => {
        if (!cancelled) setMeta(m)
      })
      .catch(() => {
        if (!cancelled) {
          setMeta({
            mode: 'self-host',
            version: '0.0.0-design',
            serverName: 'botanical.local',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (passcode: string) => {
    const result = await apiLogin(passcode)
    localStorage.setItem(TOKEN_KEY, result.token)
    setToken(result.token)
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PROFILE_KEY)
    setToken(null)
    setProfileIdState(null)
  }, [])

  const setProfileId = useCallback((id: string) => {
    localStorage.setItem(PROFILE_KEY, id)
    setProfileIdState(id)
  }, [])

  const clearProfile = useCallback(() => {
    localStorage.removeItem(PROFILE_KEY)
    setProfileIdState(null)
  }, [])

  const value = useMemo(
    () => ({
      token,
      profileId,
      meta,
      ready,
      login,
      logout,
      setProfileId,
      clearProfile,
    }),
    [token, profileId, meta, ready, login, logout, setProfileId, clearProfile],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
