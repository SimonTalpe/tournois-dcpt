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
  /** Match classé (2 comptes, 301, sortie simple) : compte pour l'Elo. */
  ranked?: boolean
  /** Match classé enregistré : écarts d'Elo (domicile = joueur qui tient le compteur, sauf admin). */
  eloDeltas?: { profileId: string; delta: number }[]
  /**
   * Match ou départage de tournoi : joueurs et format imposés, résultat reporté dans le tournoi.
   * `id`, `config`, `events` et `startedAt` décrivent alors la manche en cours.
   */
  context?: MatchContext
  /** Manches déjà jouées (match en plusieurs manches). */
  previousLegs?: PlayedLeg[]
  /** Session qui a lancé la partie (identifiant d'utilisateur) : un autre compte sur le même appareil ne la voit pas. */
  owner?: string
}

const KEY = 'mpf.darts.game'

/** Session courante (identifiant d'utilisateur, ou « local » sans compte), fixée par l'authentification. */
let currentOwner = 'local'

export function setGameOwner(owner: string | null): void {
  currentOwner = owner ?? 'local'
}

/** Partie sauvegardée de la session courante, ou null (une partie d'un autre compte est ignorée). */
export function loadSavedGame(): SavedGame | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const game = JSON.parse(raw) as SavedGame
    if (game?.version !== 1 || !Array.isArray(game.events) || !Array.isArray(game.participants)) return null
    if (game.owner !== currentOwner) return null
    return game
  } catch {
    return null
  }
}

export function saveGame(game: SavedGame | null): void {
  try {
    if (game) window.localStorage.setItem(KEY, JSON.stringify({ ...game, owner: currentOwner }))
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
