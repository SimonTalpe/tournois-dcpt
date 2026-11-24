import { Link, Navigate, useLocation } from 'react-router'
import { canViewSite, useAuth } from '../features/auth/AuthContext.ts'

/** Écran d'entrée : deux choix, « Jouer » (connexion) ou « Regarder » (code spectateur). */
export function EntryPage() {
  const auth = useAuth()
  const accountDeleted = Boolean((useLocation().state as { accountDeleted?: boolean } | null)?.accountDeleted)
  // Déjà connecté (joueur) ou spectateur : directement sur l'accueil.
  if (!auth.demoMode && !auth.loading && canViewSite(auth)) return <Navigate to="/accueil" replace />

  return (
    <main className="flex min-h-screen flex-col border-t-8 border-ochre bg-white text-black lg:grid lg:grid-cols-2">
      <div className="flex flex-col gap-4 px-5 pt-10 pb-6 sm:px-10 lg:justify-center lg:p-20">
        <h1>
          <span className="block font-display text-[120px] leading-[0.8] font-black lg:text-[200px]">MPF</span>
          <span className="mt-3 block text-lg font-semibold lg:text-[22px]">Mini-pong et fléchettes</span>
        </h1>
        <p className="max-w-[34ch] text-base leading-normal lg:text-lg">Les tournois de la pause, entre collègues de la FFT.</p>
        {accountDeleted && (
          <p role="status" className="max-w-sm border-l-4 border-black bg-mist p-3 text-[15px]">
            Ton compte a bien été supprimé. Merci d’avoir joué !
          </p>
        )}
      </div>

      <nav aria-label="Choisir comment entrer" className="mt-auto flex flex-col lg:mt-0 lg:grid lg:min-h-screen lg:grid-rows-2">
        <Link
          to="/jouer"
          className="group flex flex-col justify-end gap-3 bg-black px-5 py-7 text-white sm:px-10 lg:p-14"
        >
          <span className="font-display text-[72px] leading-[0.85] font-black group-hover:underline group-hover:decoration-4 group-hover:underline-offset-[10px] lg:text-[clamp(88px,9vw,128px)]">
            Jouer
          </span>
          <span className="text-[15px] lg:text-lg">Avec ton compte @fft.fr</span>
        </Link>
        <Link
          to="/regarder"
          className="group flex flex-col justify-end gap-3 bg-ochre px-5 pt-7 pb-10 text-white sm:px-10 lg:p-14"
        >
          <span className="font-display text-[72px] leading-[0.85] font-black group-hover:underline group-hover:decoration-4 group-hover:underline-offset-[10px] lg:text-[clamp(88px,9vw,128px)]">
            Regarder
          </span>
          <span className="text-[15px] lg:text-lg">Avec le code spectateur, sans compte</span>
        </Link>
      </nav>
    </main>
  )
}
