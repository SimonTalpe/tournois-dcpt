/**
 * Leaderboard et statistiques Elo, calculés à partir de l'historique renvoyé par la base
 * (get_elo_history). Fonctions pures, testées.
 */
import { ELO_START } from './elo.ts'

/** Nombre de matchs Elo pour apparaître dans le classement (avant : « En cours de classement »). */
export const RANKED_MIN_GAMES = 3
/** Période de comparaison de la flèche de progression. */
export const RANK_CHANGE_DAYS = 7
/** Série affichée à partir de ce nombre de victoires d'affilée. */
export const STREAK_MIN = 3

export type EloHistoryRow = {
  player_id: string
  profile_id: string | null
  full_name: string
  account_status: 'active' | 'disabled' | 'deleted' | null
  seq: number
  source: 'tournament' | 'ranked'
  match_id: string
  played_at: string
  opponent_player_id: string
  opponent_name: string
  won: boolean
  rating_before: number
  rating_after: number
  delta: number
}

export type PlayerElo = {
  playerId: string
  name: string
  rating: number
  games: number
  wins: number
  losses: number
  /** Pourcentage de victoires (0–100, arrondi). */
  winRate: number
  /** Série en cours : > 0 victoires d'affilée, < 0 défaites d'affilée. */
  streak: number
  /** Meilleur Elo atteint. */
  best: number
}

export type LeaderboardEntry = PlayerElo & {
  /** Rang (ex æquo à Elo égal) ; null tant que le joueur est en cours de classement. */
  rank: number | null
  /** Places gagnées (> 0) ou perdues (< 0) depuis 7 jours ; null si pas classé il y a 7 jours. */
  rankChange: number | null
}

export type Leaderboard = { ranked: LeaderboardEntry[]; provisional: LeaderboardEntry[] }

/** Lignes d'un joueur, dans l'ordre de ses matchs. */
function byPlayer(rows: readonly EloHistoryRow[]): Map<string, EloHistoryRow[]> {
  const map = new Map<string, EloHistoryRow[]>()
  for (const row of rows) {
    const list = map.get(row.player_id)
    if (list) list.push(row)
    else map.set(row.player_id, [row])
  }
  for (const list of map.values()) list.sort((a, b) => a.seq - b.seq)
  return map
}

/** Série en cours, à partir des résultats dans l'ordre chronologique. */
export function currentStreak(results: readonly boolean[]): number {
  if (results.length === 0) return 0
  const last = results[results.length - 1]
  let n = 0
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
  return last ? n : -n
}

/** Statistiques Elo d'un joueur (lignes de ce seul joueur). */
export function playerElo(rows: readonly EloHistoryRow[]): PlayerElo | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const last = sorted[sorted.length - 1]
  const wins = sorted.filter((r) => r.won).length
  return {
    playerId: last.player_id,
    name: last.full_name,
    rating: last.rating_after,
    games: sorted.length,
    wins,
    losses: sorted.length - wins,
    winRate: Math.round((wins / sorted.length) * 100),
    streak: currentStreak(sorted.map((r) => r.won)),
    best: Math.max(ELO_START, ...sorted.map((r) => r.rating_after)),
  }
}

/** Rangs (ex æquo à Elo égal) des joueurs classés : { playerId → rang }. */
function ranks(players: readonly { playerId: string; rating: number }[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.rating - a.rating)
  const result = new Map<string, number>()
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1]
    result.set(p.playerId, previous && previous.rating === p.rating ? (result.get(previous.playerId) as number) : i + 1)
  })
  return result
}

const collator = new Intl.Collator('fr', { sensitivity: 'base' })

/**
 * Classement d'une discipline : comptes actifs uniquement (ni noms seuls, ni comptes désactivés
 * ou supprimés). Classé après RANKED_MIN_GAMES matchs ; avant : « En cours de classement ».
 */
export function buildLeaderboard(rows: readonly EloHistoryRow[], now: Date = new Date()): Leaderboard {
  const players = byPlayer(rows.filter((r) => r.profile_id && r.account_status === 'active'))
  const cutoff = now.getTime() - RANK_CHANGE_DAYS * 24 * 3600 * 1000

  const entries: PlayerElo[] = []
  const past: { playerId: string; rating: number }[] = []
  for (const list of players.values()) {
    entries.push(playerElo(list) as PlayerElo)
    const before = list.filter((r) => new Date(r.played_at).getTime() <= cutoff)
    if (before.length >= RANKED_MIN_GAMES) {
      past.push({ playerId: list[0].player_id, rating: before[before.length - 1].rating_after })
    }
  }

  const rankedPlayers = entries.filter((e) => e.games >= RANKED_MIN_GAMES)
  const currentRanks = ranks(rankedPlayers)
  const pastRanks = ranks(past)
  const order = (a: PlayerElo, b: PlayerElo) =>
    b.rating - a.rating || b.winRate - a.winRate || b.games - a.games || collator.compare(a.name, b.name)

  const ranked = rankedPlayers.sort(order).map((e) => {
    const rank = currentRanks.get(e.playerId) as number
    const before = pastRanks.get(e.playerId)
    return { ...e, rank, rankChange: before === undefined ? null : before - rank }
  })
  const provisional = entries
    .filter((e) => e.games < RANKED_MIN_GAMES)
    .sort(order)
    .map((e) => ({ ...e, rank: null, rankChange: null }))
  return { ranked, provisional }
}

/** Courbe d'évolution : Elo de départ puis Elo après chaque match. */
export function ratingSeries(rows: readonly EloHistoryRow[]): number[] {
  return [ELO_START, ...[...rows].sort((a, b) => a.seq - b.seq).map((r) => r.rating_after)]
}

/** Écart affiché : « +14 », « −9 », « ±0 ». */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return '±0'
}
