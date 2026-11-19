import { describe, expect, it } from 'vitest'
import { dartLegsScore, numberMatches, placeholderLabel, slotSources, sortRounds } from './display.ts'
import { gameFormatLabel, type Match, type Round } from './types.ts'

const round = (id: string, bracket: Round['bracket'], round_number: number): Round => ({
  id,
  tournament_id: 't',
  bracket,
  round_number,
  name: id,
  sets_to_win: 2,
  dart_start: 301,
  dart_double_out: false,
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
  result_by: null,
  result_by_admin: false,
  result_first_at: null,
  result_at: null,
  scheduled_at: null,
  location_id: null,
  forfeit_player_id: null,
  home_legs: null,
  away_legs: null,
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

describe('fléchettes : score en manches et format', () => {
  it('score affiché seulement après plusieurs manches', () => {
    expect(dartLegsScore({ status: 'played', home_legs: 2, away_legs: 1 })).toEqual({ home: 2, away: 1 })
    expect(dartLegsScore({ status: 'played', home_legs: 0, away_legs: 2 })).toEqual({ home: 0, away: 2 })
    expect(dartLegsScore({ status: 'played', home_legs: 1, away_legs: 0 })).toBeNull()
    expect(dartLegsScore({ status: 'pending', home_legs: null, away_legs: null })).toBeNull()
  })

  it('libellé du format', () => {
    expect(gameFormatLabel('darts', { sets_to_win: 1, dart_start: 301, dart_double_out: false })).toBe('301')
    expect(gameFormatLabel('darts', { sets_to_win: 2, dart_start: 501, dart_double_out: true })).toBe(
      '501 · sortie double · 2 manches gagnantes',
    )
    expect(gameFormatLabel('mini_pong', { sets_to_win: 1, dart_start: 301 })).toBe('1 set gagnant')
  })
})
