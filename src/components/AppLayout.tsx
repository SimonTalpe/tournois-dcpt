import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { NotificationBell } from '../features/announcements/NotificationBell.tsx'
import { useNotifications } from '../features/announcements/NotificationsContext.ts'
import { NotificationsProvider } from '../features/announcements/NotificationsProvider.tsx'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'

const NAV_ITEMS = [
  { to: '/accueil', label: 'Accueil', icon: '🏠', playersOnly: false },
  { to: '/tournois', label: 'Tournois', icon: '🏆', playersOnly: false },
  { to: '/annonces', label: 'Annonces', icon: '📣', playersOnly: false },
  { to: '/profil', label: 'Profil', icon: '👤', playersOnly: true },
] as const

/** Mise en page commune : en-tête, menu en haut sur ordinateur, barre en bas sur mobile. */
export function AppLayout() {
  return (
    <NotificationsProvider>
      <Layout />
    </NotificationsProvider>
  )
}

/** Pastille « nouvelles annonces » sur l'entrée du menu. */
function UnreadDot({ to }: { to: string }) {
  const { unreadCount } = useNotifications()
  if (to !== '/annonces' || unreadCount === 0) return null
  return <span className="ml-1 inline-block h-2 w-2 rounded-full bg-clay align-middle" aria-label="nouvelles annonces" />
}

function Layout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const items = NAV_ITEMS.filter((item) => !item.playersOnly || isPlayer(auth))
  const who = auth.demoMode
    ? 'Maquette'
    : auth.access === 'spectator'
      ? '👀 Spectateur'
      : (auth.profile?.full_name ?? '')

  async function handleSignOut() {
    await auth.signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-court text-chalk shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/accueil" className="flex shrink-0 items-center gap-2 font-bold">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span className="hidden lg:inline">Mini-pong et fléchettes</span>
            <span className="lg:hidden">MPF</span>
          </Link>
          <nav className="hidden gap-1 md:flex" aria-label="Menu principal">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-ball text-court' : 'hover:bg-court-light'
                  }`
                }
              >
                {item.label}
                <UnreadDot to={item.to} />
              </NavLink>
            ))}
          </nav>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate text-chalk/80" title={who}>
              {who}
            </span>
            {!auth.demoMode && isPlayer(auth) && <NotificationBell />}
            {isAdmin(auth) && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `shrink-0 rounded-lg px-2 py-1.5 font-medium ${isActive ? 'bg-ball text-court' : 'hover:bg-court-light'}`
                }
                aria-label="Administration"
              >
                ⚙️<span className="hidden sm:inline"> Admin</span>
              </NavLink>
            )}
            {!auth.demoMode && (
              <button
                type="button"
                onClick={handleSignOut}
                className="shrink-0 rounded-lg border border-chalk/40 px-2 py-1.5 hover:bg-court-light"
              >
                {auth.access === 'spectator' ? 'Quitter' : 'Déconnexion'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:pb-8">
        <Outlet />
      </main>

      <nav
        className={`fixed inset-x-0 bottom-0 z-10 grid border-t border-court/20 bg-white pb-[env(safe-area-inset-bottom)] md:hidden ${
          items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        }`}
        aria-label="Menu principal"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-xs ${
                isActive ? 'font-semibold text-court' : 'text-ink/60'
              }`
            }
          >
            <span aria-hidden="true" className="relative text-lg">
              {item.icon}
              <span className="absolute -top-0.5 -right-2">
                <UnreadDot to={item.to} />
              </span>
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
