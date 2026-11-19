import type { SupabaseClient } from '@supabase/supabase-js'
import type { SetScore } from '../../lib/scores.ts'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import { MATCH_COLUMNS_WITH_SETS, TOURNAMENT_COLUMNS } from '../tournaments/api.ts'
import type { Match, Player, Pool, Round, Tournament } from '../tournaments/types.ts'
import type { PlayerHistoryData } from './stats.ts'

export class ProfileError extends Error {}

function db(): SupabaseClient {
  if (!supabase) throw new ProfileError("Le site n'est pas relié à la base de données.")
  return supabase
}

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new ProfileError(translateError(result.error))
  return result.data
}

/** Fiche joueur liée à un compte (absente si le compte n'a jamais été inscrit à un tournoi). */
export async function playerIdForProfile(profileId: string): Promise<string | null> {
  const row = check(await db().from('players').select('id').eq('profile_id', profileId).maybeSingle()) as {
    id: string
  } | null
  return row?.id ?? null
}

/** Tout l'historique d'un participant (tournois lancés uniquement). Null si le participant est introuvable. */
export async function loadPlayerHistory(playerId: string): Promise<PlayerHistoryData | null> {
  const client = db()
  const player = check(
    await client.from('players').select('id, profile_id, full_name').eq('id', playerId).maybeSingle(),
  ) as Player | null
  if (!player) return null

  const [entries, rawMatches] = await Promise.all([
    client.from('tournament_entries').select('tournament_id').eq('player_id', playerId),
    client.from('matches').select(MATCH_COLUMNS_WITH_SETS).or(`home_player_id.eq.${playerId},away_player_id.eq.${playerId}`),
  ])
  type SetRow = { set_number: number; home_points: number; away_points: number }
  const matchRows = check(rawMatches) as unknown as (Match & { match_sets: SetRow[] | null })[]
  const tournamentIds = [
    ...new Set([
      ...(check(entries) as { tournament_id: string }[]).map((e) => e.tournament_id),
      ...matchRows.map((m) => m.tournament_id),
    ]),
  ]
  const empty: PlayerHistoryData = { player, tournaments: [], rounds: [], matches: [], sets: new Map(), pools: [], names: new Map() }
  if (tournamentIds.length === 0) return empty

  const [tournaments, rounds, pools] = await Promise.all([
    client.from('tournaments').select(TOURNAMENT_COLUMNS).in('id', tournamentIds).neq('status', 'draft'),
    client
      .from('tournament_rounds')
      .select('id, tournament_id, bracket, round_number, name, sets_to_win, dart_start')
      .in('tournament_id', tournamentIds),
    client.from('pools').select('id, tournament_id, label').in('tournament_id', tournamentIds),
  ])
  const tournamentRows = check(tournaments) as Tournament[]
  const visible = new Set(tournamentRows.map((t) => t.id))

  const sets = new Map<string, SetScore[]>()
  const matches: Match[] = []
  for (const { match_sets, ...match } of matchRows) {
    if (!visible.has(match.tournament_id)) continue
    matches.push(match)
    if (match_sets?.length) {
      sets.set(
        match.id,
        [...match_sets].sort((a, b) => a.set_number - b.set_number).map((r) => ({ home: r.home_points, away: r.away_points })),
      )
    }
  }
  const opponentIds = [
    ...new Set(matches.flatMap((m) => [m.home_player_id, m.away_player_id]).filter((id): id is string => Boolean(id && id !== playerId))),
  ]
  const opponents = opponentIds.length
    ? (check(await client.from('players').select('id, full_name').in('id', opponentIds)) as { id: string; full_name: string }[])
    : []

  return {
    player,
    tournaments: tournamentRows,
    rounds: (check(rounds) as Round[]).filter((r) => visible.has(r.tournament_id)),
    pools: (check(pools) as Pool[]).filter((p) => visible.has(p.tournament_id)),
    matches,
    sets,
    names: new Map(opponents.map((o) => [o.id, o.full_name])),
  }
}

/** Modifie son propre nom (la base n'autorise que cette colonne). */
export async function renameMe(profileId: string, fullName: string): Promise<void> {
  check(await db().from('profiles').update({ full_name: fullName.trim() }).eq('id', profileId))
}
