import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import type { Discipline } from '../tournaments/types.ts'
import type { EloHistoryRow } from './leaderboard.ts'

export class RankingError extends Error {}

function db(): SupabaseClient {
  if (!supabase) throw new RankingError("Le site n'est pas relié à la base de données.")
  return supabase
}

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new RankingError(translateError(result.error))
  return result.data
}

/** Historique Elo d'une discipline (tous les comptes, ou un seul participant). */
export async function loadEloHistory(discipline: Discipline, playerId?: string): Promise<EloHistoryRow[]> {
  return (check(await db().rpc('get_elo_history', { p_discipline: discipline, p_player_id: playerId ?? null })) ??
    []) as EloHistoryRow[]
}

/** Score d'un match classé (format unique) : mini-pong = score du set ; fléchettes = vainqueur + reste du perdant. */
export type RankedScore = { home: number; away: number } | { winner: 'home' | 'away'; loser_remaining: number | null }

export type RankedDeltas = { id: string; home_delta: number | null; away_delta: number | null }

export async function recordRankedMatch(input: {
  id: string
  discipline: Discipline
  homeProfileId: string
  awayProfileId: string
  score: RankedScore
}): Promise<RankedDeltas> {
  return check(
    await db().rpc('record_ranked_match', {
      p_id: input.id,
      p_discipline: input.discipline,
      p_home_profile_id: input.homeProfileId,
      p_away_profile_id: input.awayProfileId,
      p_score: input.score,
    }),
  ) as RankedDeltas
}

export async function correctRankedMatch(id: string, score: RankedScore): Promise<RankedDeltas> {
  return check(await db().rpc('correct_ranked_match', { p_id: id, p_score: score })) as RankedDeltas
}

export async function deleteRankedMatch(id: string): Promise<void> {
  check(await db().rpc('delete_ranked_match', { p_id: id }))
}

/** Match classé de fléchettes joué au compteur (2 comptes, joueurs dans l'ordre de jeu). */
export async function recordRankedDartGame(input: {
  gameId: string
  startedAt: string
  players: { profile_id: string; rank: number; remaining: number; darts: number; points: number }[]
}): Promise<RankedDeltas> {
  return check(
    await db().rpc('record_ranked_dart_game', {
      p_game_id: input.gameId,
      p_started_at: input.startedAt,
      p_players: input.players,
    }),
  ) as RankedDeltas
}

type PlayerRef = { id: string; full_name: string; profile_id: string | null }

export type RankedMatch = {
  id: string
  discipline: Discipline
  home_player_id: string
  away_player_id: string
  winner_player_id: string
  home_points: number | null
  away_points: number | null
  loser_remaining: number | null
  dart_game_id: string | null
  created_by: string
  created_by_admin: boolean
  played_at: string
  updated_at: string
  home: PlayerRef | null
  away: PlayerRef | null
  author: { full_name: string } | null
}

const RANKED_COLUMNS =
  'id, discipline, home_player_id, away_player_id, winner_player_id, home_points, away_points, loser_remaining, dart_game_id, ' +
  'created_by, created_by_admin, played_at, updated_at, ' +
  'home:players!ranked_matches_home_player_id_fkey(id, full_name, profile_id), ' +
  'away:players!ranked_matches_away_player_id_fkey(id, full_name, profile_id), ' +
  'author:profiles!ranked_matches_created_by_fkey(full_name)'

/** Un match classé (joueurs connectés). Null s'il n'existe plus. */
export async function getRankedMatch(id: string): Promise<RankedMatch | null> {
  return check(
    await db().from('ranked_matches').select(RANKED_COLUMNS).eq('id', id).maybeSingle(),
  ) as unknown as RankedMatch | null
}

/** Matchs classés d'un participant, les plus récents d'abord. */
export async function listPlayerRankedMatches(playerId: string): Promise<RankedMatch[]> {
  return check(
    await db()
      .from('ranked_matches')
      .select(RANKED_COLUMNS)
      .or(`home_player_id.eq.${playerId},away_player_id.eq.${playerId}`)
      .order('played_at', { ascending: false }),
  ) as unknown as RankedMatch[]
}

/** Comptes proposés comme adversaires (actifs, email confirmé). */
export async function listRankablePeople(): Promise<{ id: string; full_name: string }[]> {
  const rows = (check(await db().rpc('dart_list_people')) ?? []) as { kind: string; id: string; full_name: string }[]
  return rows.filter((r) => r.kind === 'account').map(({ id, full_name }) => ({ id, full_name }))
}
