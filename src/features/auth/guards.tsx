import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { canViewSite, isAdmin, isPlayer, useAuth } from './AuthContext.ts'

export function LoadingScreen() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-ink/60" role="status">
      Chargement…
    </div>
  )
}

/** Pages du site : joueur, admin ou spectateur. Sinon retour à l'écran d'entrée. */
export function RequireViewer({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return <LoadingScreen />
  if (auth.access === 'disabled') return <Navigate to="/jouer?desactive=1" replace />
  if (!canViewSite(auth)) return <Navigate to="/" replace state={{ from: location.pathname }} />
  if (auth.profile?.must_change_password) return <Navigate to="/nouveau-mot-de-passe" replace />
  return children
}

/** Pages réservées aux joueurs connectés (profils, historiques…). */
export function RequirePlayer({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return <LoadingScreen />
  if (!isPlayer(auth)) return <Navigate to="/jouer" replace />
  return children
}

/** Pages réservées à l'admin. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.loading) return <LoadingScreen />
  if (!isAdmin(auth)) return <Navigate to="/accueil" replace />
  return children
}
