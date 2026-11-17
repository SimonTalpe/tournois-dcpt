import { Link, NavLink, Outlet } from 'react-router'

const NAV_ITEMS = [
  { to: '/accueil', label: 'Accueil', icon: '🏠' },
  { to: '/tournois', label: 'Tournois', icon: '🏆' },
  { to: '/annonces', label: 'Annonces', icon: '📣' },
  { to: '/regles', label: 'Règles', icon: '📖' },
  { to: '/profil', label: 'Profil', icon: '👤' },
] as const

/** Mise en page commune : en-tête, menu en haut sur ordinateur, barre en bas sur mobile. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-court text-chalk shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/accueil" className="flex items-center gap-2 font-bold">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span className="hidden sm:inline">Mini-pong et fléchettes</span>
            <span className="sm:hidden">MPF</span>
          </Link>
          <nav className="hidden gap-1 md:flex" aria-label="Menu principal">
            {NAV_ITEMS.map((item) => (
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
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:pb-8">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-court/20 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Menu principal"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-xs ${
                isActive ? 'font-semibold text-court' : 'text-ink/60'
              }`
            }
          >
            <span aria-hidden="true" className="text-lg">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
