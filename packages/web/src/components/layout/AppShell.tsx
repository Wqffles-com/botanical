import { type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Cloud, House, Inbox, MessageSquare, PanelLeft, Settings, Sprout } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useSession } from '../../state/session'
import { Mark, Wordmark } from '../ui/Logo'
import { Button } from '../ui/primitives'

const nav = [
  { to: '/chats', label: 'Chats', icon: MessageSquare },
  { to: '/agents', label: 'Agents', icon: Sprout },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell({
  pane,
  paneOpen,
  onTogglePane,
  onInbox,
  unreadA2A,
}: {
  pane?: ReactNode
  paneOpen: boolean
  onTogglePane: () => void
  onInbox: () => void
  unreadA2A: number
}) {
  const { meta } = useSession()

  return (
    <div className="flex h-full bg-canvas text-ink">
      <nav
        className="hidden w-14 shrink-0 flex-col items-center border-r border-line bg-shell py-3 md:flex"
        aria-label="Primary"
      >
        <NavLink to="/chats" className="mb-6" aria-label="Botanical home">
          <Mark className="size-8" />
        </NavLink>
        <div className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  'flex size-10 items-center justify-center rounded-md text-mute transition-colors',
                  isActive ? 'bg-hover text-leaf' : 'hover:bg-hover hover:text-ink',
                )
              }
            >
              <item.icon className="size-[18px]" />
            </NavLink>
          ))}
        </div>
        {meta ? (
          <div
            className="flex size-10 items-center justify-center text-mute"
            title={meta.mode === 'self-host' ? 'Self-host' : 'SaaS'}
          >
            {meta.mode === 'self-host' ? (
              <House className="size-4" />
            ) : (
              <Cloud className="size-4 text-seed" />
            )}
          </div>
        ) : null}
      </nav>

      {paneOpen && pane ? (
        <button
          type="button"
          className="fixed inset-0 z-10 bg-canvas/50 md:hidden"
          aria-label="Close sidebar"
          onClick={onTogglePane}
        />
      ) : null}

      {pane ? (
        <aside
          className={cn(
            'w-[272px] shrink-0 flex-col border-r border-line bg-shell',
            'max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-2xl',
            paneOpen ? 'flex' : 'hidden md:flex',
          )}
        >
          <div className="flex h-12 items-center justify-between border-b border-line px-3">
            <Wordmark className="text-[1.25rem]" />
            <Button variant="quiet" size="icon" onClick={onInbox} aria-label="Teammate inbox">
              <span className="relative">
                <Inbox className="size-4" />
                {unreadA2A > 0 ? (
                  <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-seed" />
                ) : null}
              </span>
            </Button>
          </div>
          <div className="min-h-0 flex-1">{pane}</div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 md:hidden">
          <Button variant="quiet" size="icon" onClick={onTogglePane} aria-label="Toggle sidebar">
            <PanelLeft className="size-4" />
          </Button>
          <span className="font-serif text-lg">Botanical</span>
          <div className="ml-auto flex items-center gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex size-8 items-center justify-center rounded-md',
                    isActive ? 'bg-hover text-leaf' : 'text-mute',
                  )
                }
              >
                <item.icon className="size-4" />
              </NavLink>
            ))}
          </div>
        </div>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
