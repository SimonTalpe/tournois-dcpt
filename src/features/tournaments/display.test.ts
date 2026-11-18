import { describe, expect, it } from 'vitest'
import { numberMatches, placeholderLabel, slotSources, sortRounds } from './display.ts'
import type { Match, Round } from './types.ts'

const round = (id: string, bracket: Round['bracket'], round_number: number): Round => ({
  id,
  tournament_id: 't',
  bracket,
  round_number,
  name: id,
  sets_to_win: 2,
  dart_start: 301,
})

const match = (id: string, round_id: string, position: number, extra: Partial<Match> = {}): Match => ({
  id,
  tournament_id: 't',
  round_id,
  pool_id: null,
  position,
  home_player_id: null,
  away_player_id: null,
  winner_player_id: null,
  status: 'pending',
  next_match_id: null,
  next_slot: null,
  loser_next_match_id: null,
  loser_next_slot: null,
  ...extra,
})

describe('affichage des tableaux', () => {
  const rounds = [round('c1', 'consolation', 1), round('m2', 'main', 2), round('p', 'pool', 1), round('m1', 'main', 1), round('t', 'third_place', 1)]
  const matches = [
    match('a', 'm1', 1, { next_match_id: 'f', next_slot: 'away', loser_next_match_id: 'k', loser_next_slot: 'home' }),
    match('b', 'm1', 2, { next_match_id: 'f', next_slot: 'home' }),
    match('f', 'm2', 1),
    match('k', 'c1', 1),
    match('x', 'p', 1),
  ]

  it('ordre des tours', () => {
    expect(sortRounds(rounds).map((r) => r.id)).toEqual(['p', 'm1', 'm2', 't', 'c1'])
  })

  it('numérotation des matchs hors poules', () => {
    const numbers = numberMatches(rounds, matches)
    expect([...numbers.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
      ['f', 3],
      ['k', 4],
    ])
  })

  it('textes d’attente', () => {
    const numbers = numberMatches(rounds, matches)
    const sources = slotSources(matches)
    expect(placeholderLabel(sources.get('f:home'), numbers)).toBe('Vainqueur M2')
    expect(placeholderLabel(sources.get('f:away'), numbers)).toBe('Vainqueur M1')
    expect(placeholderLabel(sources.get('k:home'), numbers)).toBe('Perdant M1')
    expect(placeholderLabel(undefined, numbers)).toBe('À déterminer')
  })
})
