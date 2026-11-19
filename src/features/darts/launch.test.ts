import { describe, expect, it } from 'vitest'
import { launchDecision } from './launch.ts'
import { createContextGame, type MatchContext } from './match.ts'
import type { SavedGame } from './storage.ts'

const ctx: MatchContext = {
  kind: 'match',
  tournamentId: 't',
  tournamentName: 'T',
  label: 'Finale',
  matchId: 'm1',
  legsToWin: 1,
  start: 301,
  doubleOut: false,
  players: [
    { playerId: 'a', name: 'A' },
    { playerId: 'b', name: 'B' },
  ],
}

const free: SavedGame = {
  version: 1,
  id: 'g',
  local: false,
  config: { start: 301, doubleOut: false, players: [{ key: 'k', name: 'X' }] },
  participants: [],
  events: [],
  startedAt: '2026-11-19T10:00:00Z',
  recorded: false,
}

describe('lancement du compteur depuis un match', () => {
  it('rien en cours, ou partie déjà enregistrée : on lance', () => {
    expect(launchDecision(null, ctx)).toBe('start')
    expect(launchDecision({ ...free, recorded: true, events: [{ type: 'stop' }] }, ctx)).toBe('start')
    expect(launchDecision(free, ctx)).toBe('start')
  })

  it('même match déjà en cours : on reprend', () => {
    expect(launchDecision(createContextGame(ctx), ctx)).toBe('resume')
  })

  it('autre partie en cours : confirmation', () => {
    expect(launchDecision({ ...free, events: [{ type: 'stop' }] }, ctx)).toBe('confirm')
    expect(launchDecision(createContextGame({ ...ctx, matchId: 'm2' }), ctx)).toBe('confirm')
  })
})
