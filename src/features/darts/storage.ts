import type { Participant } from './api.ts'
import type { GameConfig, GameEvent } from './engine.ts'
import type { MatchContext } from './match.ts'

/** Manche terminée d'un match de tournoi (rejouable pour l'affichage et l'annulation). */
export type PlayedLeg = { id: string; config: GameConfig; events: GameEvent[]; startedAt: string }

/**
 * Partie sauvegardée sur l'appareil : un rechargement, une mise en veille ou une fermeture
 * de l'application ne font rien perdre. Le stockage du navigateur peut être indisponible
 * (navigation privée…) : la partie continue alors simplement en mémoire.
 */
export type SavedGame = {
  version: 1
  id: string
  /** Partie enregistrée en base (joueur connecté) ou locale (spectateur). */
  local: boolean
  config: GameConfig
  participants: Participant[]
  events: GameEvent[]
  startedAt: string
  /** Résultat enregistré en base. */
  recorded: boolean
  /**
   * Match ou départage de tournoi : joueurs et format imposés, résultat reporté dans le tournoi.
   * `id`, `config`, `events` et `startedAt` décrivent alors la manche en cours.
   */
  context?: MatchContext
  /** Manches déjà jouées (match en plusieurs manches). */
  previousLegs?: PlayedLeg[]
}

const KEY = 'mpf.darts.game'

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const game = JSON.parse(raw) as SavedGame
    if (game?.version !== 1 || !Array.isArray(game.events) || !Array.isArray(game.participants)) return null
    return game
  } catch {
    return null
  }
}

export function saveGame(game: SavedGame | null): void {
  try {
    if (game) window.localStorage.setItem(KEY, JSON.stringify(game))
    else window.localStorage.removeItem(KEY)
  } catch {
    // Stockage indisponible : la partie reste en mémoire.
  }
}

export function newGameId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Repli (contexte non sécurisé) : identifiant v4 maison.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
