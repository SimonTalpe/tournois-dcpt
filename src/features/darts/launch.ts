import { createContextGame, type MatchContext } from './match.ts'
import { loadSavedGame, saveGame, type SavedGame } from './storage.ts'

function sameTarget(a: MatchContext, b: MatchContext): boolean {
  if (a.kind === 'match' && b.kind === 'match') return a.matchId === b.matchId
  if (a.kind === 'tiebreak' && b.kind === 'tiebreak') {
    const ids = (c: MatchContext) => c.players.map((p) => p.playerId).sort().join()
    return a.poolId === b.poolId && ids(a) === ids(b)
  }
  return false
}

/**
 * Lancement du compteur depuis un match ou un départage :
 * - resume : la même partie est déjà en cours sur l'appareil, on la reprend ;
 * - confirm : une autre partie est en cours ou non enregistrée, à abandonner d'abord ;
 * - start : rien en cours.
 */
export function launchDecision(existing: SavedGame | null, context: MatchContext): 'resume' | 'confirm' | 'start' {
  if (!existing || existing.recorded) return 'start'
  if (existing.context && sameTarget(existing.context, context)) return 'resume'
  const started = existing.events.length > 0 || (existing.previousLegs?.length ?? 0) > 0
  return started || existing.context ? 'confirm' : 'start'
}

/** Prépare la partie sur l'appareil ; renvoie false si l'utilisateur garde la partie en cours. */
export function prepareTournamentGame(context: MatchContext, confirm: (message: string) => boolean = window.confirm): boolean {
  const existing = loadSavedGame()
  const decision = launchDecision(existing, context)
  if (decision === 'resume') return true
  if (decision === 'confirm' && !confirm('Une partie est en cours sur ce téléphone. L’abandonner pour lancer celle-ci ?')) {
    return false
  }
  saveGame(createContextGame(context))
  return true
}
