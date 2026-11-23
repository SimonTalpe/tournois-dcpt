/**
 * Calcul de l'Elo (identique à la fonction elo_refresh de la base, qui fait foi).
 * Ici comme référence testée : la simulation de la base compare ses résultats à ce calcul.
 *
 * - Départ 1200 ; K = 40 pendant les 10 premiers matchs du joueur dans la discipline, puis 20.
 * - Résultat binaire (victoire = 1, défaite = 0) : le score n'influe pas.
 * - Adversaire sans compte (nom seul) : Elo fixe 1200, jamais mis à jour, pas d'historique.
 */

export const ELO_START = 1200
export const PROVISIONAL_K = 40
export const ESTABLISHED_K = 20
export const PROVISIONAL_K_GAMES = 10

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_K_GAMES ? PROVISIONAL_K : ESTABLISHED_K
}

/** Score attendu d'un joueur classé `rating` contre `opponent` (entre 0 et 1). */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400))
}

/** Arrondi « à l'écart de zéro » (comme round(numeric) de PostgreSQL). */
export function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/** Écart d'Elo d'un joueur après un match. */
export function eloDelta(rating: number, gamesPlayed: number, opponent: number, won: boolean): number {
  return roundHalfAway(kFactor(gamesPlayed) * ((won ? 1 : 0) - expectedScore(rating, opponent)))
}

export type EloEvent = {
  id: string
  source: 'tournament' | 'ranked'
  playedAt: string
  homeId: string
  awayId: string
  /** Joueur lié à un compte (sinon nom seul : Elo fixe, pas d'historique). */
  homeAccount: boolean
  awayAccount: boolean
  winnerId: string
}

export type EloRow = {
  playerId: string
  seq: number
  source: EloEvent['source']
  matchId: string
  playedAt: string
  opponentId: string
  won: boolean
  ratingBefore: number
  ratingAfter: number
  delta: number
}

/** Rejoue les matchs (déjà dans l'ordre chronologique) et renvoie l'historique de chaque compte. */
export function replayElo(events: readonly EloEvent[]): EloRow[] {
  const state = new Map<string, { rating: number; games: number }>()
  const rows: EloRow[] = []
  const current = (id: string, account: boolean) => (account ? state.get(id) : undefined) ?? { rating: ELO_START, games: 0 }

  for (const e of events) {
    const home = current(e.homeId, e.homeAccount)
    const away = current(e.awayId, e.awayAccount)
    const sides = [
      { id: e.homeId, account: e.homeAccount, me: home, opponentId: e.awayId, opponent: away },
      { id: e.awayId, account: e.awayAccount, me: away, opponentId: e.homeId, opponent: home },
    ]
    const computed: EloRow[] = []
    for (const side of sides) {
      if (!side.account) continue
      const won = e.winnerId === side.id
      const delta = eloDelta(side.me.rating, side.me.games, side.opponent.rating, won)
      computed.push({
        playerId: side.id,
        seq: side.me.games + 1,
        source: e.source,
        matchId: e.id,
        playedAt: e.playedAt,
        opponentId: side.opponentId,
        won,
        ratingBefore: side.me.rating,
        ratingAfter: side.me.rating + delta,
        delta,
      })
    }
    // Mise à jour après le calcul des deux côtés (chacun part de l'Elo d'avant le match).
    for (const row of computed) {
      state.set(row.playerId, { rating: row.ratingAfter, games: row.seq })
      rows.push(row)
    }
  }
  return rows
}
