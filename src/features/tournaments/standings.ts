import { buildFinalPhase, type DrawResult } from '../../lib/draw/plan.ts'
import { computePoolStanding, finalStandings, groupKey, type PoolStandingResult, type Tiebreak } from '../../lib/standings.ts'
import type { Pool, PoolTiebreak, TournamentBundle } from './types.ts'

export type PoolStanding = { pool: Pool; result: PoolStandingResult; tiebreaks: PoolTiebreak[] }

/** Classement de chaque poule du tournoi (départages saisis compris). */
export function poolStandings(bundle: TournamentBundle): PoolStanding[] {
  const { pools, entries, matches, sets, tournament } = bundle
  return pools.map((pool) => {
    const tiebreaks = bundle.tiebreaks.filter((t) => t.pool_id === pool.id)
    const byGroup = new Map<string, Tiebreak>(tiebreaks.map((t) => [groupKey(t.player_ids), { ranking: t.ranking }]))
    const result = computePoolStanding(
      entries.filter((e) => e.pool_id === pool.id).map((e) => e.player_id),
      matches
        .filter((m) => m.pool_id === pool.id && m.home_player_id && m.away_player_id)
        .map((m) => ({
          home: m.home_player_id as string,
          away: m.away_player_id as string,
          status: m.status,
          winner: m.winner_player_id,
          sets: sets.get(m.id) ?? [],
        })),
      tournament.discipline,
      tournament.qualifiers_per_pool ?? 0,
      byGroup,
    )
    return { pool, result, tiebreaks }
  })
}

/** Phase finale calculée à partir des classements, ou la liste de ce qui manque. */
export function computeFinalPhase(bundle: TournamentBundle): { ok: true; draw: DrawResult } | { ok: false; problems: string[] } {
  const ready = finalStandings(poolStandings(bundle).map(({ pool, result }) => ({ label: pool.label, result })))
  if (!ready.ok) return ready
  const { tournament } = bundle
  return {
    ok: true,
    draw: buildFinalPhase(ready.standings, {
      qualifiersPerPool: tournament.qualifiers_per_pool,
      thirdPlace: tournament.third_place,
      consolation: tournament.consolation,
      placement: tournament.qualifier_placement,
    }),
  }
}
