import { setsWon, type SetScore } from '../../lib/scores.ts'
import type { Discipline, Match, Player, Pool, Round, Tournament } from '../tournaments/types.ts'

/**
 * Profil d'un joueur : historique des tournois et des matchs, statistiques par discipline,
 * meilleur parcours. Fonctions pures, testées.
 */

export type PlayerHistoryData = {
  player: Player
  /** Tournois (hors brouillons) où le joueur est inscrit ou a joué. */
  tournaments: Tournament[]
  /** Tous les tours de ces tournois. */
  rounds: Round[]
  /** Matchs du joueur dans ces tournois. */
  matches: Match[]
  sets: Map<string, SetScore[]>
  pools: Pool[]
  /** Noms des participants (adversaires). */
  names: Map<string, string>
}

export type Finish = {
  label: string
  /** Classement approché (1 = vainqueur), pour comparer les parcours ; null si pas encore connu. */
  rank: number | null
  /** Parcours terminé (éliminé, ou tournoi joué jusqu'au bout) ? */
  final: boolean
}

export type Outcome = 'win' | 'loss' | 'walkover_win' | 'walkover_loss' | 'pending' | 'bye' | 'cancelled'

export type HistoryMatch = {
  match: Match
  roundLabel: string
  opponent: string | null
  outcome: Outcome
  /** Sets (mini-pong) du point de vue du joueur. */
  score: { mine: number; theirs: number } | null
}

export type TournamentHistory = {
  tournament: Tournament
  finish: Finish
  matches: HistoryMatch[]
}

export type DisciplineStats = {
  discipline: Discipline
  tournaments: number
  played: number
  wins: number
  losses: number
  /** Pourcentage de victoires (0–100), null sans match joué. */
  winRate: number | null
  /** Mini-pong : sets gagnés / perdus. */
  setsFor: number
  setsAgainst: number
  /** Matchs gagnés ou perdus par forfait (non comptés dans les matchs joués). */
  walkovers: number
  best: { finish: Finish; tournament: Tournament } | null
}

function outcomeOf(match: Match, playerId: string): Outcome {
  switch (match.status) {
    case 'played':
      return match.winner_player_id === playerId ? 'win' : 'loss'
    case 'walkover':
      return match.forfeit_player_id === playerId ? 'walkover_loss' : 'walkover_win'
    case 'bye':
      return 'bye'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

const decided = (o: Outcome) => o === 'win' || o === 'loss' || o === 'walkover_win' || o === 'walkover_loss' || o === 'bye'
const won = (o: Outcome) => o === 'win' || o === 'walkover_win' || o === 'bye'

/** Nom d'élimination selon la distance à la finale (1 = demi-finale…). */
function eliminationLabel(depth: number, roundName: string): { label: string; rank: number } {
  const rank = 2 ** depth + 1
  if (depth === 1) return { label: 'Demi-finaliste', rank }
  if (depth === 2) return { label: 'Quart de finaliste', rank }
  if (depth === 3) return { label: 'Huitième de finaliste', rank }
  return { label: `Éliminé au tour « ${roundName} »`, rank }
}

/** Parcours du joueur dans un tournoi. */
export function tournamentFinish(
  tournament: Tournament,
  rounds: readonly Round[],
  matches: readonly Match[],
  playerId: string,
): Finish {
  const roundOf = new Map(rounds.map((r) => [r.id, r]))
  const mine = matches.filter(
    (m) => m.tournament_id === tournament.id && (m.home_player_id === playerId || m.away_player_id === playerId),
  )
  const mainRounds = rounds.filter((r) => r.tournament_id === tournament.id && r.bracket === 'main')
  const lastMainRound = Math.max(0, ...mainRounds.map((r) => r.round_number))
  const inMain = mine
    .filter((m) => roundOf.get(m.round_id)?.bracket === 'main' && m.status !== 'cancelled')
    .sort((a, b) => (roundOf.get(b.round_id)?.round_number ?? 0) - (roundOf.get(a.round_id)?.round_number ?? 0))
  const finished = tournament.status === 'finished' || tournament.status === 'archived'

  // Consolante gagnée : mentionnée en plus du parcours principal.
  const consolationRounds = rounds.filter((r) => r.tournament_id === tournament.id && r.bracket === 'consolation')
  const lastConsolation = Math.max(0, ...consolationRounds.map((r) => r.round_number))
  const consolationWon = mine.some((m) => {
    const round = roundOf.get(m.round_id)
    return round?.bracket === 'consolation' && round.round_number === lastConsolation && won(outcomeOf(m, playerId)) && m.status !== 'bye'
  })
  const withConsolation = (f: Finish): Finish =>
    consolationWon ? { ...f, label: `${f.label} · vainqueur de la consolante` } : f

  if (inMain.length === 0) {
    if (mainRounds.length === 0) {
      // Poules en cours (phase finale pas encore générée).
      return finished
        ? { label: 'Phase de poules', rank: 1000, final: true }
        : { label: tournament.format === 'pools_knockout' ? 'Phase de poules en cours' : 'En cours', rank: null, final: false }
    }
    return withConsolation({ label: 'Phase de poules', rank: 1000, final: true })
  }

  const deepest = inMain[0]
  const deepestRound = roundOf.get(deepest.round_id)!
  const outcome = outcomeOf(deepest, playerId)
  const depth = lastMainRound - deepestRound.round_number

  if (depth === 0) {
    if (!decided(outcome)) return { label: 'En finale', rank: null, final: false }
    return won(outcome) ? { label: 'Vainqueur', rank: 1, final: true } : { label: 'Finaliste', rank: 2, final: true }
  }
  if (!decided(outcome) || won(outcome)) {
    // Encore en lice (match à jouer, ou vainqueur en attente du tour suivant).
    return { label: `En lice — ${deepestRound.name}`, rank: null, final: false }
  }
  // Éliminé : match pour la 3e place éventuel.
  const third = mine.find((m) => roundOf.get(m.round_id)?.bracket === 'third_place')
  if (third) {
    const o = outcomeOf(third, playerId)
    if (!decided(o)) return { label: 'Match pour la 3e place à jouer', rank: null, final: false }
    return won(o) ? { label: '3e', rank: 3, final: true } : { label: '4e', rank: 4, final: true }
  }
  const { label, rank } = eliminationLabel(depth, deepestRound.name)
  return withConsolation({ label, rank, final: true })
}

/** « Poule A », « Demi-finales », « Consolante — 1er tour »… */
function roundLabel(match: Match, rounds: Map<string, Round>, pools: Map<string, Pool>): string {
  if (match.pool_id) return `Poule ${pools.get(match.pool_id)?.label ?? ''}`.trim()
  return rounds.get(match.round_id)?.name ?? ''
}

/** Historique : tournois du plus récent au plus ancien, matchs dans l'ordre du tournoi. */
export function playerHistory(data: PlayerHistoryData): TournamentHistory[] {
  const playerId = data.player.id
  const rounds = new Map(data.rounds.map((r) => [r.id, r]))
  const pools = new Map(data.pools.map((p) => [p.id, p]))
  const order = { pool: 0, main: 1, third_place: 2, consolation: 3 } as const
  return [...data.tournaments]
    .sort((a, b) => (b.launched_at ?? b.created_at).localeCompare(a.launched_at ?? a.created_at))
    .map((tournament) => {
      const matches = data.matches
        .filter((m) => m.tournament_id === tournament.id)
        .filter((m) => m.home_player_id === playerId || m.away_player_id === playerId)
        .sort((a, b) => {
          const ra = rounds.get(a.round_id)
          const rb = rounds.get(b.round_id)
          return (
            (ra ? order[ra.bracket] : 0) - (rb ? order[rb.bracket] : 0) ||
            (ra?.round_number ?? 0) - (rb?.round_number ?? 0) ||
            a.position - b.position
          )
        })
        .map((match): HistoryMatch => {
          const isHome = match.home_player_id === playerId
          const opponentId = isHome ? match.away_player_id : match.home_player_id
          const sets = data.sets.get(match.id)
          const counts = match.status === 'played' && sets?.length ? setsWon(sets) : null
          return {
            match,
            roundLabel: roundLabel(match, rounds, pools),
            opponent: opponentId ? (data.names.get(opponentId) ?? 'Joueur inconnu') : null,
            outcome: outcomeOf(match, playerId),
            score: counts ? { mine: isHome ? counts.home : counts.away, theirs: isHome ? counts.away : counts.home } : null,
          }
        })
      return { tournament, finish: tournamentFinish(tournament, data.rounds, data.matches, playerId), matches }
    })
}

/** Statistiques par discipline (seules les disciplines pratiquées). Les forfaits ne comptent pas comme matchs joués. */
export function disciplineStats(history: readonly TournamentHistory[]): DisciplineStats[] {
  const result: DisciplineStats[] = []
  for (const discipline of ['mini_pong', 'darts'] as const) {
    const entries = history.filter((h) => h.tournament.discipline === discipline)
    if (entries.length === 0) continue
    const matches = entries.flatMap((h) => h.matches)
    const wins = matches.filter((m) => m.outcome === 'win').length
    const losses = matches.filter((m) => m.outcome === 'loss').length
    const played = wins + losses
    let best: DisciplineStats['best'] = null
    for (const h of entries) {
      if (h.finish.rank === null || !h.finish.final) continue
      if (!best || h.finish.rank < (best.finish.rank ?? Infinity)) best = { finish: h.finish, tournament: h.tournament }
    }
    result.push({
      discipline,
      tournaments: entries.length,
      played,
      wins,
      losses,
      winRate: played ? Math.round((wins / played) * 100) : null,
      setsFor: matches.reduce((sum, m) => sum + (m.score?.mine ?? 0), 0),
      setsAgainst: matches.reduce((sum, m) => sum + (m.score?.theirs ?? 0), 0),
      walkovers: matches.filter((m) => m.outcome === 'walkover_win' || m.outcome === 'walkover_loss').length,
      best,
    })
  }
  return result
}
