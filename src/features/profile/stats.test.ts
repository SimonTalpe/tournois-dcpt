import { describe, expect, it } from 'vitest'
import type { Match, Round, Tournament } from '../tournaments/types.ts'
import { disciplineStats, playerHistory, tournamentFinish, type PlayerHistoryData } from './stats.ts'

const tournament = (id: string, over: Partial<Tournament> = {}): Tournament => ({
  id,
  name: id,
  description: '',
  discipline: 'mini_pong',
  format: 'knockout',
  status: 'finished',
  pool_count: null,
  qualifiers_per_pool: null,
  qualifier_placement: 'classic',
  third_place: false,
  consolation: false,
  default_sets_to_win: 2,
  default_dart_start: 301,
  launched_at: '2026-12-01T00:00:00Z',
  created_at: '2026-11-30T00:00:00Z',
  ...over,
})

const round = (t: string, bracket: Round['bracket'], n: number, name: string): Round => ({
  id: `${t}-${bracket}-${n}`,
  tournament_id: t,
  bracket,
  round_number: n,
  name,
  sets_to_win: 2,
  dart_start: 301,
})

let seq = 0
function match(t: string, roundId: string, home: string | null, away: string | null, over: Partial<Match> = {}): Match {
  seq += 1
  return {
    id: `m${seq}`,
    tournament_id: t,
    round_id: roundId,
    pool_id: null,
    position: seq,
    home_player_id: home,
    away_player_id: away,
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
    ...over,
  }
}
const played = (winner: string): Partial<Match> => ({ status: 'played', winner_player_id: winner })

// Tableau de 8 : quarts (1), demies (2), finale (3)
const rounds8 = (t: string) => [
  round(t, 'main', 1, 'Quarts de finale'),
  round(t, 'main', 2, 'Demi-finales'),
  round(t, 'main', 3, 'Finale'),
]

describe('parcours dans un tournoi', () => {
  it('vainqueur et finaliste', () => {
    const t = tournament('t1')
    const rounds = rounds8('t1')
    const matches = [
      match('t1', 't1-main-1', 'me', 'a', played('me')),
      match('t1', 't1-main-2', 'me', 'b', played('me')),
      match('t1', 't1-main-3', 'c', 'me', played('me')),
    ]
    expect(tournamentFinish(t, rounds, matches, 'me')).toEqual({ label: '🏆 Vainqueur', rank: 1, final: true })
    expect(tournamentFinish(t, rounds, matches, 'c')).toEqual({ label: '🥈 Finaliste', rank: 2, final: true })
  })

  it('éliminé en quart, en demie, ou 3e/4e avec petite finale', () => {
    const rounds = rounds8('t2')
    const t = tournament('t2')
    expect(tournamentFinish(t, rounds, [match('t2', 't2-main-1', 'me', 'a', played('a'))], 'me')).toMatchObject({
      label: 'Quart de finaliste',
      rank: 5,
    })
    expect(
      tournamentFinish(t, rounds, [match('t2', 't2-main-1', 'me', 'a', played('me')), match('t2', 't2-main-2', 'b', 'me', played('b'))], 'me'),
    ).toMatchObject({ label: 'Demi-finaliste', rank: 3 })
    const withThird = [...rounds, round('t2', 'third_place', 1, 'Match pour la 3e place')]
    const semis = [match('t2', 't2-main-1', 'me', 'a', played('me')), match('t2', 't2-main-2', 'b', 'me', played('b'))]
    expect(
      tournamentFinish(t, withThird, [...semis, match('t2', 't2-third_place-1', 'me', 'x', played('me'))], 'me'),
    ).toMatchObject({ label: '🥉 3e', rank: 3 })
    expect(
      tournamentFinish(t, withThird, [...semis, match('t2', 't2-third_place-1', 'me', 'x', played('x'))], 'me'),
    ).toMatchObject({ label: '4e', rank: 4 })
  })

  it('exempt au 1er tour puis éliminé, forfait, consolante gagnée', () => {
    const rounds = [...rounds8('t3'), round('t3', 'consolation', 1, 'Consolante — Finale')]
    const t = tournament('t3')
    const matches = [
      match('t3', 't3-main-1', 'me', null, { status: 'bye', winner_player_id: 'me' }),
      match('t3', 't3-main-2', 'me', 'b', { status: 'walkover', winner_player_id: 'b', forfeit_player_id: 'me' }),
    ]
    expect(tournamentFinish(t, rounds, matches, 'me')).toMatchObject({ label: 'Demi-finaliste', rank: 3 })
    const loserOfQuarter = [
      match('t3', 't3-main-1', 'me', 'a', played('a')),
      match('t3', 't3-consolation-1', 'me', 'z', played('me')),
    ]
    expect(tournamentFinish(t, rounds, loserOfQuarter, 'me').label).toBe('Quart de finaliste · vainqueur de la consolante')
  })

  it('tournoi en cours : en lice, ou poules', () => {
    const t = tournament('t4', { status: 'in_progress' })
    const rounds = rounds8('t4')
    expect(tournamentFinish(t, rounds, [match('t4', 't4-main-1', 'me', 'a')], 'me')).toEqual({
      label: 'En lice — Quarts de finale',
      rank: null,
      final: false,
    })
    const pools = tournament('t5', { status: 'in_progress', format: 'pools_knockout' })
    expect(tournamentFinish(pools, [round('t5', 'pool', 1, 'Poules')], [], 'me')).toMatchObject({
      label: 'Phase de poules en cours',
      final: false,
    })
    // Phase finale générée sans le joueur : éliminé en poule.
    expect(
      tournamentFinish(pools, [round('t5', 'pool', 1, 'Poules'), ...rounds8('t5')], [match('t5', 't5-main-1', 'a', 'b')], 'me'),
    ).toMatchObject({ label: 'Phase de poules', rank: 1000, final: true })
  })
})

describe('historique et statistiques', () => {
  const t1 = tournament('p1')
  const t2 = tournament('d1', { discipline: 'darts', launched_at: '2026-12-10T00:00:00Z' })
  const t3 = tournament('p2', { status: 'in_progress', launched_at: '2026-12-15T00:00:00Z' })
  const m1 = match('p1', 'p1-main-1', 'me', 'a', played('me'))
  const m2 = match('p1', 'p1-main-2', 'b', 'me', played('b'))
  const m3 = match('d1', 'd1-main-3', 'me', 'c', played('me'))
  const m4 = match('p2', 'p2-main-1', 'me', 'd', { status: 'walkover', winner_player_id: 'me', forfeit_player_id: 'd' })
  const m5 = match('p2', 'p2-main-2', 'me', null)
  const data: PlayerHistoryData = {
    player: { id: 'me', profile_id: 'u', full_name: 'Moi' },
    tournaments: [t1, t2, t3],
    rounds: [...rounds8('p1'), ...rounds8('d1'), ...rounds8('p2')],
    matches: [m1, m2, m3, m4, m5],
    sets: new Map([
      [m1.id, [{ home: 11, away: 5 }, { home: 11, away: 9 }]],
      [m2.id, [{ home: 11, away: 3 }, { home: 8, away: 11 }, { home: 11, away: 7 }]],
    ]),
    pools: [],
    names: new Map([
      ['a', 'Alice'],
      ['b', 'Bob'],
      ['c', 'Chloé'],
      ['d', 'David'],
    ]),
  }

  it('liste les tournois du plus récent au plus ancien, avec le détail des matchs', () => {
    const history = playerHistory(data)
    expect(history.map((h) => h.tournament.id)).toEqual(['p2', 'd1', 'p1'])
    const p1 = history[2]
    expect(p1.finish.label).toBe('Demi-finaliste')
    expect(p1.matches.map((m) => [m.roundLabel, m.opponent, m.outcome, m.score])).toEqual([
      ['Quarts de finale', 'Alice', 'win', { mine: 2, theirs: 0 }],
      ['Demi-finales', 'Bob', 'loss', { mine: 1, theirs: 2 }],
    ])
    expect(history[0].matches.map((m) => [m.outcome, m.opponent])).toEqual([
      ['walkover_win', 'David'],
      ['pending', null],
    ])
  })

  it('calcule les statistiques par discipline (forfaits à part) et le meilleur parcours', () => {
    const stats = disciplineStats(playerHistory(data))
    expect(stats).toHaveLength(2)
    const [miniPong, darts] = stats
    expect(miniPong).toMatchObject({
      discipline: 'mini_pong',
      tournaments: 2,
      played: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      setsFor: 3,
      setsAgainst: 2,
      walkovers: 1,
    })
    expect(miniPong.best?.finish.label).toBe('Demi-finaliste')
    expect(darts).toMatchObject({ played: 1, wins: 1, winRate: 100 })
    expect(darts.best?.finish.label).toBe('🏆 Vainqueur')
  })

  it('aucun match joué : pas de pourcentage', () => {
    const stats = disciplineStats(playerHistory({ ...data, tournaments: [t3], matches: [m5] }))
    expect(stats[0]).toMatchObject({ played: 0, winRate: null, best: null })
  })
})
