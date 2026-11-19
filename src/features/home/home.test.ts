import { describe, expect, it } from 'vitest'
import type { Match, Tournament, TournamentBundle } from '../tournaments/types.ts'
import { myTournamentsInProgress, myUpcomingMatches, progress, recentResults } from './home.ts'

const tournament = (id: string, name: string, status: Tournament['status'] = 'in_progress'): Tournament => ({
  id,
  name,
  description: '',
  discipline: 'mini_pong',
  format: 'knockout',
  status,
  pool_count: null,
  qualifiers_per_pool: null,
  qualifier_placement: 'classic',
  third_place: false,
  consolation: false,
  default_sets_to_win: 2,
  default_dart_start: 301,
  default_dart_double_out: false,
  launched_at: null,
  created_at: '',
})

const base: Omit<Match, 'id' | 'tournament_id' | 'position' | 'home_player_id' | 'away_player_id'> = {
  round_id: 'r1',
  pool_id: null,
  winner_player_id: null,
  status: 'pending',
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
}

function bundle(t: Tournament, matches: Match[]): TournamentBundle {
  const ids = ['me', 'bob', 'carl', 'dan']
  return {
    tournament: t,
    entries: ids.map((id) => ({ tournament_id: t.id, player_id: `${t.id}-${id}`, pool_id: null })),
    players: new Map(
      ids.map((id) => [
        `${t.id}-${id}`,
        { id: `${t.id}-${id}`, profile_id: id === 'me' ? 'profile-me' : null, full_name: id.toUpperCase() },
      ]),
    ),
    pools: [],
    rounds: [
      { id: 'r1', tournament_id: t.id, bracket: 'main', round_number: 1, name: 'Demi-finales', sets_to_win: 2, dart_start: 301, dart_double_out: false },
      { id: 'r2', tournament_id: t.id, bracket: 'main', round_number: 2, name: 'Finale', sets_to_win: 2, dart_start: 301, dart_double_out: false },
    ],
    matches,
    sets: new Map(),
    tiebreaks: [],
    locations: [{ id: 'l2', name: '2e étage' }],
    authors: new Map(),
  }
}

describe('page d’accueil', () => {
  const t1 = tournament('t1', 'Mini-pong')
  const t1Matches: Match[] = [
    { ...base, id: 'a1', tournament_id: 't1', position: 1, home_player_id: 't1-me', away_player_id: 't1-bob', next_match_id: 'a3', next_slot: 'home' },
    {
      ...base,
      id: 'a2',
      tournament_id: 't1',
      position: 2,
      home_player_id: 't1-carl',
      away_player_id: 't1-dan',
      next_match_id: 'a3',
      next_slot: 'away',
      status: 'played',
      winner_player_id: 't1-carl',
      result_at: '2026-12-01T10:00:00Z',
    },
    { ...base, id: 'a3', tournament_id: 't1', round_id: 'r2', position: 1, home_player_id: null, away_player_id: 't1-carl' },
  ]
  const t2 = tournament('t2', 'Fléchettes')
  const t2Matches: Match[] = [
    {
      ...base,
      id: 'b1',
      tournament_id: 't2',
      position: 1,
      home_player_id: 't2-dan',
      away_player_id: 't2-me',
      scheduled_at: '2026-12-03T11:00:00Z',
      location_id: 'l2',
    },
    {
      ...base,
      id: 'b2',
      tournament_id: 't2',
      position: 2,
      home_player_id: 't2-carl',
      away_player_id: 't2-bob',
      status: 'walkover',
      winner_player_id: 't2-carl',
      forfeit_player_id: 't2-bob',
      result_at: '2026-12-02T10:00:00Z',
    },
    { ...base, id: 'b3', tournament_id: 't2', round_id: 'r2', position: 1, home_player_id: null, away_player_id: null, next_match_id: null },
  ]
  // b3 attend le vainqueur de b1 (moi) : on relie b1 → b3.
  t2Matches[0].next_match_id = 'b3'
  t2Matches[0].next_slot = 'home'
  const finished = tournament('t3', 'Ancien', 'finished')
  const bundles = [bundle(t1, t1Matches), bundle(t2, t2Matches), bundle(finished, [])]

  it('liste mes prochains matchs, ceux avec horaire d’abord', () => {
    const mine = myUpcomingMatches(bundles, 'profile-me')
    expect(mine.map((m) => m.match.id)).toEqual(['b1', 'a1'])
    expect(mine[0]).toMatchObject({ opponent: 'DAN', opponentKnown: true, locationName: '2e étage', roundLabel: 'Demi-finales · M1' })
    expect(mine[1].tournament.name).toBe('Mini-pong')
  })

  it('montre un adversaire en attente', () => {
    // Je gagne a1 → je suis placé en finale (a3) face à Carl ; on simule plutôt l'attente en retirant Carl.
    const waiting = t1Matches.map((m) =>
      m.id === 'a1'
        ? { ...m, status: 'played' as const, winner_player_id: 't1-me', result_at: '2026-12-02T09:00:00Z' }
        : m.id === 'a3'
          ? { ...m, home_player_id: 't1-me', away_player_id: null }
          : m.id === 'a2'
            ? { ...m, status: 'pending' as const, winner_player_id: null, result_at: null }
            : m,
    )
    const mine = myUpcomingMatches([bundle(t1, waiting)], 'profile-me')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ opponent: 'Vainqueur M2', opponentKnown: false, roundLabel: 'Finale · M3' })
  })

  it('ignore les autres joueurs et les tournois terminés', () => {
    expect(myUpcomingMatches(bundles, 'someone-else')).toEqual([])
    expect(myUpcomingMatches(bundles, null)).toEqual([])
    expect(myTournamentsInProgress(bundles, 'profile-me').map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('donne les derniers résultats, le plus récent d’abord', () => {
    const results = recentResults(bundles)
    expect(results.map((r) => r.match.id)).toEqual(['b2', 'a2'])
    expect(results[0]).toMatchObject({ forfeitName: 'BOB', home: 'CARL', away: 'BOB' })
    expect(recentResults(bundles, 1)).toHaveLength(1)
  })

  it('calcule l’avancement d’un tournoi', () => {
    expect(progress(bundles[0])).toEqual({ done: 1, total: 3 })
  })
})
