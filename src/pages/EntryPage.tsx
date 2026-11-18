import { Link, Navigate } from 'react-router'
import { canViewSite, useAuth } from '../features/auth/AuthContext.ts'

/** Écran d'entrée : deux choix, « Jouer » (connexion) ou « Regarder » (code spectateur). */
export function EntryPage() {
  const auth = useAuth()
  // Déjà connecté (joueur) ou spectateur : directement sur l'accueil.
  if (!auth.demoMode && !auth.loading && canViewSite(auth)) return <Navigate to="/accueil" replace />

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-court px-6 py-12 text-chalk">
      <div className="flex flex-col items-center gap-4 text-center">
        <img src="/pwa-192x192.png" alt="" className="h-24 w-24 rounded-3xl shadow-lg" />
        <h1 className="text-3xl font-bold sm:text-4xl">Mini-pong et fléchettes</h1>
        <p className="max-w-sm text-chalk/80">Les tournois de la pause, entre collègues.</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-4">
        <Link
          to="/jouer"
          className="rounded-2xl bg-ball px-6 py-4 text-center text-lg font-bold text-court shadow-lg transition hover:brightness-105 active:scale-[0.98]"
        >
          🏓 Jouer
          <span className="block text-sm font-normal">Se connecter avec son compte</span>
        </Link>
        <Link
          to="/regarder"
          className="rounded-2xl border-2 border-chalk/70 px-6 py-4 text-center text-lg font-bold transition hover:bg-court-light active:scale-[0.98]"
        >
          👀 Regarder
          <span className="block text-sm font-normal">Suivre les tournois avec le code commun</span>
        </Link>
      </div>
    </main>
  )
}
