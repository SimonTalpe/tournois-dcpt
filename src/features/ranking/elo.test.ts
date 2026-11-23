import { describe, expect, it } from 'vitest'
import { eloDelta, expectedScore, kFactor, replayElo, roundHalfAway, type EloEvent } from './elo.ts'

const event = (id: string, home: string, away: string, winner: string, accounts = { home: true, away: true }): EloEvent => ({
  id,
  source: 'ranked',
  playedAt: `2026-11-2${id}T12:00:00Z`,
  homeId: home,
  awayId: away,
  homeAccount: accounts.home,
  awayAccount: accounts.away,
  winnerId: winner,
})

describe('Elo', () => {
  it('K vaut 40 pendant les 10 premiers matchs, puis 20', () => {
    expect(kFactor(0)).toBe(40)
    expect(kFactor(9)).toBe(40)
    expect(kFactor(10)).toBe(20)
  })

  it('score attendu : 0,5 à Elo égal, symétrique', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5)
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1)
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909, 3)
  })

  it('arrondi à l’écart de zéro (comme PostgreSQL)', () => {
    expect(roundHalfAway(2.5)).toBe(3)
    expect(roundHalfAway(-2.5)).toBe(-3)
    expect(roundHalfAway(-2.4)).toBe(-2)
  })

  it('écarts : battre plus fort rapporte plus', () => {
    expect(eloDelta(1200, 0, 1200, true)).toBe(20)
    expect(eloDelta(1200, 0, 1200, false)).toBe(-20)
    expect(eloDelta(1200, 0, 1400, true)).toBeGreaterThan(20)
    expect(eloDelta(1200, 20, 1200, true)).toBe(10)
  })

  it('rejoue les matchs (mêmes valeurs que les tests de la base)', () => {
    const rows = replayElo([
      event('1', 'alice', 'david', 'alice', { home: true, away: false }),
      event('2', 'alice', 'bob', 'alice'),
      event('3', 'bob', 'alice', 'bob'),
    ])
    const alice = rows.filter((r) => r.playerId === 'alice')
    const bob = rows.filter((r) => r.playerId === 'bob')
    expect(alice.map((r) => r.ratingAfter)).toEqual([1220, 1239, 1216])
    expect(bob.map((r) => r.ratingAfter)).toEqual([1181, 1204])
    expect(alice.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(rows.some((r) => r.playerId === 'david')).toBe(false)
  })

  it('le nom seul reste à 1200 quel que soit le résultat', () => {
    const rows = replayElo([
      event('1', 'alice', 'david', 'david', { home: true, away: false }),
      event('2', 'bob', 'david', 'david', { home: true, away: false }),
    ])
    expect(rows.map((r) => r.ratingBefore)).toEqual([1200, 1200])
    expect(rows.map((r) => r.delta)).toEqual([-20, -20])
  })

  it('passe à K = 20 au 11e match', () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      ...event('1', 'alice', 'david', 'alice', { home: true, away: false }),
      id: `m${i}`,
    }))
    const rows = replayElo(events)
    // Les écarts diminuent au fil des victoires et chutent nettement au 11e match (K = 20).
    expect(rows[10].delta).toBeLessThan(rows[9].delta / 1.5)
  })
})
