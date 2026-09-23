import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { WorkspaceLayout } from './components/layout/WorkspaceLayout'
import { Mark } from './components/ui/Logo'
import { AgentsScreen } from './screens/AgentsScreen'
import { ChatsScreen } from './screens/ChatsScreen'
import { LoginScreen } from './screens/LoginScreen'
import { ProfileGateScreen } from './screens/ProfileGateScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useSession } from './state/session'
import { WorkspaceProvider } from './state/workspace'

function Boot() {
  return (
    <div className="flex h-full items-center justify-center">
      <Mark className="size-10 animate-pulse" />
    </div>
  )
}

function AuthGate() {
  const { token, ready } = useSession()
  if (!ready) return <Boot />
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function ProfileGate() {
  const { profileId } = useSession()
  if (!profileId) return <Navigate to="/pick-profile" replace />
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route element={<AuthGate />}>
        <Route path="/pick-profile" element={<ProfileGateScreen />} />
        <Route element={<ProfileGate />}>
          <Route element={<WorkspaceLayout />}>
            <Route path="/" element={<Navigate to="/chats" replace />} />
            <Route path="/chats" element={<ChatsScreen />} />
            <Route path="/chats/:id" element={<ChatsScreen />} />
            <Route path="/agents" element={<AgentsScreen />} />
            <Route path="/agents/:id" element={<AgentsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
