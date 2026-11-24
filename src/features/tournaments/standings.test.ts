import { describe, expect, it } from 'vitest'
import { computeFinalPhase, poolStandings } from './standings.ts'
import type { Match, Tournament, TournamentBundle } from './types.ts'

const tournament: Tournament = {
  id: 't',
  name: 'Test',
  description: '',
  discipline: 'darts',
  format: 'pools_knockout',
  status: 'in_progress',
  pool_count: 2,
  qualifiers_per_pool: 2,
  qualifier_placement: 'classic',
  third_place: false,
  consolation: true,
  default_sets_to_win: 1,
  default_dart_start: 301,
  default_dart_double_out: false,
  qualification_wins: null,
  qualification_losses: null,
  qualification_pairing: null,
  qualification_next_stage: null,
  group_size: null,
  group_qualifiers: null,
  launched_at: null,
  created_at: '',
}

let n = 0
const match = (pool: string, home: string, away: string, winner: string | null): Match => ({
  id: `m${++n}`,
  tournament_id: 't',
  round_id: 'r-pool',
  pool_id: pool,
  position: n,
  home_player_id: home,
  away_player_id: away,
  winner_player_id: winner,
  status: winner ? 'played' : 'pending',
  next_match_id: null,
  next_slot: null,
  loser_next_match_id: null,
  loser_next_slot: null,
  result_by: null,
  result_by_admin: false,
  result_first_at: null,
  result_at: null,
  scheduled_at: null,
  location_id: null,
  forfeit_player_id: null,
  home_legs: null,
  away_legs: null,
})

function bundle(matches: Match[], tiebreaks: TournamentBundle['tiebreaks'] = []): TournamentBundle {
  const entries = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({
    tournament_id: 't',
    player_id: id,
    pool_id: id.startsWith('a') ? 'A' : 'B',
  }))
  return {
    tournament,
    entries,
    players: new Map(entries.map((e) => [e.player_id, { id: e.player_id, profile_id: null, full_name: e.player_id }])),
    pools: [
      { id: 'A', tournament_id: 't', label: 'A' },
      { id: 'B', tournament_id: 't', label: 'B' },
    ],
    rounds: [{ id: 'r-pool', tournament_id: 't', bracket: 'pool', round_number: 1, name: 'Poules', sets_to_win: 1, dart_start: 301, dart_double_out: false }],
    matches,
    sets: new Map(),
    tiebreaks,
    locations: [],
    authors: new Map(),
  }
}

describe('phase finale depuis les poules', () => {
  const poolB = [match('B', 'b1', 'b2', 'b1'), match('B', 'b2', 'b3', 'b2'), match('B', 'b1', 'b3', 'b1')]

  it('génère le tableau des qualifiés et la consolante des éliminés', () => {
    const result = computeFinalPhase(
      bundle([match('A', 'a1', 'a2', 'a1'), match('A', 'a2', 'a3', 'a2'), match('A', 'a1', 'a3', 'a1'), ...poolB]),
    )
    if (!result.ok) throw new Error(result.problems.join())
    const plan = result.draw.plan
    const firstRound = plan.matches.filter((m) => m.roundKey === 'main-1')
    expect(new Set(firstRound.flatMap((m) => [m.home, m.away]))).toEqual(new Set(['a1', 'a2', 'b1', 'b2']))
    // Croisement classique : 1A–2B et 1B–2A
    expect(firstRound.map((m) => [m.home, m.away].sort().join('-')).sort()).toEqual(['a1-b2', 'a2-b1'])
    expect(plan.matches.some((m) => m.roundKey.startsWith('consolation') && [m.home, m.away].includes('a3'))).toBe(true)
  })

  it('refuse tant qu’une égalité de qualification n’est pas départagée, puis l’applique', () => {
    // Poule A en cycle : égalité à trois pour 2 places.
    const cycle = [match('A', 'a1', 'a2', 'a1'), match('A', 'a2', 'a3', 'a2'), match('A', 'a3', 'a1', 'a3'), ...poolB]
    expect(computeFinalPhase(bundle(cycle))).toEqual({ ok: false, problems: ['Poule A : égalité à départager.'] })

    const tiebreak = {
      id: 'tb',
      pool_id: 'A',
      player_ids: ['a1', 'a2', 'a3'],
      ranking: ['a3', 'a1', 'a2'],
      result_by: null,
      result_by_admin: true,
      result_first_at: '',
      result_at: '',
    }
    const withTiebreak = bundle(cycle, [tiebreak])
    expect(poolStandings(withTiebreak)[0].result.rows.map((r) => r.playerId)).toEqual(['a3', 'a1', 'a2'])
    const result = computeFinalPhase(withTiebreak)
    if (!result.ok) throw new Error(result.problems.join())
    const firstRound = result.draw.plan.matches.filter((m) => m.roundKey === 'main-1')
    expect(new Set(firstRound.flatMap((m) => [m.home, m.away]))).toEqual(new Set(['a3', 'a1', 'b1', 'b2']))
  })

  it('poule inachevée : génération impossible', () => {
    const result = computeFinalPhase(
      bundle([match('A', 'a1', 'a2', 'a1'), match('A', 'a2', 'a3', null), match('A', 'a1', 'a3', 'a1'), ...poolB]),
    )
    expect(result).toEqual({ ok: false, problems: ['Poule A : tous les matchs ne sont pas joués.'] })
  })
})
