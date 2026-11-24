import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { UPDATE_CHECK_MS } from '../lib/version.ts'

/**
 * Bandeau « Nouvelle version disponible — Recharger ».
 * Le service worker (PWA) garde le site en cache : sans ce bandeau, l'ancienne version restait affichée
 * après une mise à jour. On vérifie s'il existe une nouvelle version au démarrage, toutes les 15 minutes
 * et au retour sur l'application (téléphone sorti de veille).
 */
/** Délai au-delà duquel on recharge la page même si le nouveau service worker ne s'est pas manifesté. */
const RELOAD_FALLBACK_MS = 2500

export function UpdateBanner() {
  const [reloading, setReloading] = useState(false)
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

  /**
   * Active la nouvelle version puis recharge la page.
   * La bibliothèque ne recharge que si la page était déjà contrôlée par le service worker : après un
   * rechargement forcé (Ctrl+Maj+R), ce n'est pas le cas et le bouton restait sans effet (19/11/2026).
   * On recharge donc dès que le nouveau service worker prend la main, et au plus tard après 2,5 s.
   */
  async function reload() {
    setReloading(true)
    let done = false
    const go = () => {
      if (done) return
      done = true
      window.location.reload()
    }
    navigator.serviceWorker?.addEventListener('controllerchange', go)
    setTimeout(go, RELOAD_FALLBACK_MS)
    await updateServiceWorker(true).catch(() => {})
  }

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 border-t-4 border-ochre bg-black px-4 py-3 text-[15px] text-white md:bottom-4"
    >
      <span className="flex-1">Nouvelle version disponible.</span>
      <button
        type="button"
        onClick={() => void reload()}
        disabled={reloading}
        className="min-h-11 bg-white px-3 font-semibold text-black disabled:opacity-70"
      >
        {reloading ? 'Rechargement…' : 'Recharger'}
      </button>
      <button
        type="button"
        aria-label="Plus tard"
        title="Plus tard"
        onClick={() => setNeedRefresh(false)}
        className="min-h-11 min-w-11 text-white"
      >
        ✕
      </button>
    </div>
  )
}
