import { useEffect } from 'react'

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> }

/** Garde l'écran allumé tant que `active` est vrai (si le navigateur le permet). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!active || !wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    async function acquire() {
      try {
        const s = await wakeLock!.request('screen')
        if (cancelled) void s.release()
        else sentinel = s
      } catch {
        // Refusé (économie d'énergie…) : sans conséquence.
      }
    }
    // Le verrou est perdu quand l'onglet passe en arrière-plan : on le reprend au retour.
    function onVisible() {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}

/** Petite vibration (téléphones compatibles). */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Non pris en charge.
  }
}
