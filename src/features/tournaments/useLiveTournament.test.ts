import { describe, expect, it } from 'vitest'
import { concernsTournament, type LiveContext } from './useLiveTournament.ts'

const context: LiveContext = { tournamentId: 't1', poolIds: new Set(['p1']), roundIds: new Set(['r1']) }
const change = (
  table: string,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  row: Record<string, unknown>,
) => ({ table, eventType, new: eventType === 'DELETE' ? {} : row, old: eventType === 'DELETE' ? row : {} })

describe('temps réel : événements concernant le tournoi affiché', () => {
  it('matchs, inscriptions, tours, tournoi : par identifiant de tournoi', () => {
    expect(concernsTournament(change('matches', 'UPDATE', { tournament_id: 't1' }), context)).toBe(true)
    expect(concernsTournament(change('matches', 'UPDATE', { tournament_id: 't2' }), context)).toBe(false)
    expect(concernsTournament(change('tournament_entries', 'INSERT', { tournament_id: 't1' }), context)).toBe(true)
    expect(concernsTournament(change('tournament_rounds', 'INSERT', { tournament_id: 't1' }), context)).toBe(true)
    expect(concernsTournament(change('tournaments', 'UPDATE', { id: 't1' }), context)).toBe(true)
    expect(concernsTournament(change('tournaments', 'UPDATE', { id: 't2' }), context)).toBe(false)
  })

  it('départages : par poule du tournoi', () => {
    expect(concernsTournament(change('pool_tiebreaks', 'INSERT', { pool_id: 'p1' }), context)).toBe(true)
    expect(concernsTournament(change('pool_tiebreaks', 'UPDATE', { pool_id: 'p9' }), context)).toBe(false)
  })

  it('suppressions (sans filtre possible) : tours reconnus par identifiant, matchs toujours rechargés', () => {
    expect(concernsTournament(change('tournament_rounds', 'DELETE', { id: 'r1' }), context)).toBe(true)
    expect(concernsTournament(change('tournament_rounds', 'DELETE', { id: 'r9' }), context)).toBe(false)
    expect(concernsTournament(change('matches', 'DELETE', { id: 'm1' }), context)).toBe(true)
  })

  it('autres tables ignorées', () => {
    expect(concernsTournament(change('profiles', 'UPDATE', { id: 'x' }), context)).toBe(false)
  })
})
