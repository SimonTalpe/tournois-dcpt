import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { NotificationBell } from '../features/announcements/NotificationBell.tsx'
import { NotificationsProvider } from '../features/announcements/NotificationsProvider.tsx'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { getInitials } from '../lib/initials.ts'
import { visibleNavCount } from '../lib/navOverflow.ts'
import { APP_VERSION } from '../lib/version.ts'
import { Icon, type IconName } from './ui.tsx'

const NAV_ITEMS: readonly { to: string; label: string; icon: IconName; playersOnly: boolean }[] = [
  { to: '/accueil', label: 'Accueil', icon: 'home', playersOnly: false },
  { to: '/tournois', label: 'Tournois', icon: 'tournaments', playersOnly: false },
  { to: '/compteur', label: 'Compteur', icon: 'darts', playersOnly: false },
  { to: '/classement', label: 'Classement', icon: 'ranking', playersOnly: false },
  { to: '/profil', label: 'Profil', icon: 'profile', playersOnly: true },
]

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
  const fullName = auth.profile?.full_name ?? ''
  async function handleSignOut(to = '/') {
    await auth.signOut()
    navigate(to, { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col border-t-8 border-ochre bg-white">
      <header className="sticky top-0 z-10 border-b-2 border-black bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/accueil" className="flex shrink-0 items-baseline gap-2.5 text-black">
            <span className="font-display text-[30px] leading-none font-black sm:text-[34px]">MPF</span>
            <span className="text-sm font-medium max-[359px]:hidden">Mini-pong et fléchettes</span>
          </Link>
          <TopNav items={items} />
          <div className="flex min-w-0 items-center gap-1.5 md:shrink-0">
            {auth.demoMode && <span className="text-sm text-muted">Maquette</span>}
            {!auth.demoMode && isPlayer(auth) && <NotificationBell />}
            {isAdmin(auth) && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold ${
                    isActive ? 'bg-ochre-text text-white' : 'bg-black text-white hover:bg-ochre-text'
                  }`
                }
                aria-label="Administration"
              >
                <Icon name="settings" className="h-4 w-4" />
                <span className="hidden sm:inline">Administration</span>
              </NavLink>
            )}
            {player && fullName && (
              <NavLink
                to="/profil"
                aria-label={`Mon profil, ${fullName}`}
                title={fullName}
                className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white md:inline-flex"
              >
                {getInitials(fullName)}
              </NavLink>
            )}
            {!auth.demoMode && auth.access === 'spectator' && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSignOut('/jouer')}
                  className="hidden min-h-11 shrink-0 items-center border-2 border-black px-3 text-sm font-semibold hover:bg-black hover:text-white sm:inline-flex"
                >
                  Se connecter pour jouer
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="min-h-11 shrink-0 px-2 text-sm font-medium underline underline-offset-4"
                >
                  Quitter
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-10">
        <Outlet />
        <p className="pt-10 text-center text-[11px] text-muted">Version du {APP_VERSION}</p>
      </main>

      <nav
        className={`fixed inset-x-0 bottom-0 z-10 grid border-t-2 border-black bg-white px-0.5 pt-1 pb-[max(10px,env(safe-area-inset-bottom))] md:hidden ${
          items.length === 6 ? 'grid-cols-6' : items.length === 5 ? 'grid-cols-5' : items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        }`}
        aria-label="Menu principal"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-[3px] text-[11px] tracking-tight ${
                isActive ? 'font-bold text-ochre-text' : 'font-medium text-black'
              }`
            }
          >
            <Icon name={item.icon} />
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
  const linkClass = 'inline-flex min-h-11 items-center whitespace-nowrap px-3 text-[15px] font-medium text-black'

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
            className={({ isActive }) =>
              `${linkClass} ${isActive ? 'underline decoration-ochre decoration-[3px] underline-offset-8' : 'hover:underline hover:underline-offset-8'}`
            }
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
              className={`${linkClass} ${hiddenActive ? 'underline decoration-ochre decoration-[3px] underline-offset-8' : ''}`}
            >
              Plus ▾
            </button>
            {open && (
              <div className="absolute top-full left-0 z-20 mt-1 min-w-[11rem] border-2 border-black bg-white py-1 text-black">
                {hidden.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-2 px-4 text-[15px] ${isActive ? 'bg-ochre-tint font-semibold text-ochre-text' : 'hover:bg-mist'}`
                    }
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
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
