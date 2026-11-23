import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { NotificationBell } from '../features/announcements/NotificationBell.tsx'
import { NotificationsProvider } from '../features/announcements/NotificationsProvider.tsx'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { visibleNavCount } from '../lib/navOverflow.ts'
import { APP_VERSION } from '../lib/version.ts'

const NAV_ITEMS = [
  { to: '/accueil', label: 'Accueil', icon: '🏠', playersOnly: false },
  { to: '/tournois', label: 'Tournois', icon: '🏆', playersOnly: false },
  { to: '/classement', label: 'Classement', icon: '🏅', playersOnly: false },
  { to: '/compteur', label: 'Compteur', icon: '🎯', playersOnly: false },
  { to: '/profil', label: 'Profil', icon: '👤', playersOnly: true },
] as const

type NavItem = (typeof NAV_ITEMS)[number]

/** Espace entre deux entrées du menu du haut (classe `gap-1`). */
const NAV_GAP = 4

/** Mise en page commune : en-tête, menu en haut sur ordinateur, barre en bas sur mobile. */
export function AppLayout() {
  return (
    <NotificationsProvider>
      <Layout />
    </NotificationsProvider>
  )
}

function Layout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const player = isPlayer(auth)
  const items = useMemo(() => NAV_ITEMS.filter((item) => !item.playersOnly || player), [player])
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
          <TopNav items={items} />
          <div className="flex min-w-0 items-center gap-2 text-sm md:shrink-0">
            <span className="max-w-[9rem] truncate text-chalk/80 lg:max-w-[14rem]" title={who}>
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
        <p className="pt-10 text-center text-[11px] text-ink/40">Version du {APP_VERSION}</p>
      </main>

      <nav
        className={`fixed inset-x-0 bottom-0 z-10 grid border-t border-court/20 bg-white pb-[env(safe-area-inset-bottom)] md:hidden ${
          items.length === 6 ? 'grid-cols-6' : items.length === 5 ? 'grid-cols-5' : items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        }`}
        aria-label="Menu principal"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center gap-0.5 px-0 py-2 text-[10px] tracking-tighter min-[360px]:px-0.5 min-[360px]:tracking-tight min-[400px]:text-[11px] sm:text-xs sm:tracking-normal ${
                isActive ? 'text-court min-[360px]:font-semibold' : 'text-ink/60'
              }`
            }
          >
            <span aria-hidden="true" className="text-lg">
              {item.icon}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/**
 * Menu du haut (ordinateur / tablette) : les entrées qui ne tiennent pas dans la largeur
 * disponible passent dans un menu déroulant « Plus ».
 */
function TopNav({ items }: { items: readonly NavItem[] }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(items.length)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  // Mesure la largeur de chaque entrée (copie invisible du menu) et la place disponible.
  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    const update = () => {
      const children = Array.from(measure.children) as HTMLElement[]
      const widths = children.slice(0, items.length).map((child) => child.offsetWidth)
      const moreWidth = children[items.length]?.offsetWidth ?? 0
      setVisible(visibleNavCount(widths, moreWidth, row.clientWidth, NAV_GAP))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [items])

  // Fermeture du menu « Plus » : clic à l'extérieur ou touche Échap.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const shown = items.slice(0, visible)
  const hidden = items.slice(visible)
  const hiddenActive = hidden.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
  const linkClass = 'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition'

  return (
    <nav className="relative hidden min-w-0 flex-1 md:block" aria-label="Menu principal">
      {/* Copie invisible servant uniquement à mesurer les largeurs. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex gap-1"
      >
        {items.map((item) => (
          <span key={item.to} className={linkClass}>
            {item.label}
          </span>
        ))}
        <span className={linkClass}>Plus ▾</span>
      </div>

      <div ref={rowRef} className="flex w-full gap-1">
        {shown.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${linkClass} ${isActive ? 'bg-ball text-court' : 'hover:bg-court-light'}`}
          >
            {item.label}
          </NavLink>
        ))}
        {hidden.length > 0 && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-haspopup="true"
              className={`${linkClass} ${hiddenActive ? 'bg-ball text-court' : 'hover:bg-court-light'}`}
            >
              Plus ▾
            </button>
            {open && (
              <div className="absolute top-full left-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-lg bg-white py-1 text-ink shadow-lg ring-1 ring-court/20">
                {hidden.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-4 py-2 text-sm ${isActive ? 'bg-ball/40 font-semibold text-court' : 'hover:bg-chalk'}`
                    }
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
