import { useRegisterSW } from 'virtual:pwa-register/react'
import { UPDATE_CHECK_MS } from '../lib/version.ts'

/**
 * Bandeau « Nouvelle version disponible — Recharger ».
 * Le service worker (PWA) garde le site en cache : sans ce bandeau, l'ancienne version restait affichée
 * après une mise à jour. On vérifie s'il existe une nouvelle version au démarrage, toutes les 15 minutes
 * et au retour sur l'application (téléphone sorti de veille).
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine && document.visibilityState === 'visible') void registration.update().catch(() => {})
      }
      setInterval(check, UPDATE_CHECK_MS)
      document.addEventListener('visibilitychange', check)
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-chalk shadow-lg md:bottom-4"
    >
      <span className="flex-1">✨ Nouvelle version disponible.</span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="rounded-lg bg-ball px-3 py-1.5 font-semibold text-court"
      >
        Recharger
      </button>
      <button
        type="button"
        aria-label="Plus tard"
        title="Plus tard"
        onClick={() => setNeedRefresh(false)}
        className="px-1 text-chalk/60 hover:text-chalk"
      >
        ✕
      </button>
    </div>
  )
}
