import { describe, expect, it } from 'vitest'
import { checkMiniPongSets, checkSet, maxSets, parseSetRows, resultRights, setsWon, type ResultContext } from './scores.ts'

describe('checkSet', () => {
  it('accepte les sets valides', () => {
    for (const [home, away] of [
      [11, 0],
      [11, 9],
      [9, 11],
      [12, 10],
      [15, 13],
      [10, 12],
    ]) {
      expect(checkSet({ home, away }), `${home}-${away}`).toBeNull()
    }
  })

  it('refuse les sets invalides', () => {
    expect(checkSet({ home: 10, away: 8 })).toMatch(/11 points/)
    expect(checkSet({ home: 11, away: 10 })).toMatch(/2 points/)
    expect(checkSet({ home: 12, away: 9 })).toMatch(/exactement/)
    expect(checkSet({ home: 11, away: 11 })).toMatch(/2 points/)
    expect(checkSet({ home: -1, away: 11 })).toMatch(/0 à 99/)
    expect(checkSet({ home: 11.5, away: 3 })).toMatch(/0 à 99/)
  })
})

describe('checkMiniPongSets', () => {
  it('déduit le vainqueur', () => {
    expect(checkMiniPongSets([{ home: 11, away: 5 }], 1)).toEqual({ ok: true, winner: 'home' })
    expect(
      checkMiniPongSets(
        [
          { home: 11, away: 5 },
          { home: 9, away: 11 },
          { home: 10, away: 12 },
        ],
        2,
      ),
    ).toEqual({ ok: true, winner: 'away' })
  })

  it('refuse un match inachevé, un set de trop ou un set invalide', () => {
    expect(checkMiniPongSets([], 2)).toMatchObject({ ok: false })
    expect(checkMiniPongSets([{ home: 11, away: 5 }], 2)).toMatchObject({ ok: false, error: expect.stringMatching(/inachevé/) })
    expect(
      checkMiniPongSets(
        [
          { home: 11, away: 5 },
          { home: 11, away: 5 },
          { home: 5, away: 11 },
        ],
        2,
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Set 3 en trop/) })
    expect(
      checkMiniPongSets(
        [
          { home: 11, away: 5 },
          { home: 11, away: 10 },
        ],
        2,
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Set 2 \(11-10\)/) })
  })

  it('compte les sets et le nombre maximal de sets', () => {
    expect(setsWon([{ home: 11, away: 5 }, { home: 3, away: 11 }, { home: 11, away: 9 }])).toEqual({ home: 2, away: 1 })
    expect([1, 2, 3].map(maxSets)).toEqual([1, 3, 5])
  })
})

describe('parseSetRows', () => {
  it('ignore les lignes vides et lit les nombres', () => {
    expect(parseSetRows([{ home: '11', away: ' 4' }, { home: '', away: '' }])).toEqual({ sets: [{ home: 11, away: 4 }] })
  })
  it('refuse une ligne incomplète', () => {
    expect(parseSetRows([{ home: '11', away: '' }])).toMatchObject({ error: expect.stringMatching(/Set 1/) })
    expect(parseSetRows([{ home: 'onze', away: '3' }])).toMatchObject({ error: expect.any(String) })
  })
})

describe('resultRights', () => {
  const pending: ResultContext = {
    status: 'pending',
    homePlayerId: 'pa',
    awayPlayerId: 'pb',
    resultBy: null,
    resultByAdmin: false,
    resultFirstAt: null,
  }
  const alice = { isAdmin: false, isActivePlayer: true, profileId: 'alice', playerId: 'pa' }
  const bob = { isAdmin: false, isActivePlayer: true, profileId: 'bob', playerId: 'pb' }
  const admin = { isAdmin: true, isActivePlayer: true, profileId: 'sim', playerId: null }
  const spectator = { isAdmin: false, isActivePlayer: false, profileId: null, playerId: null }
  const now = new Date('2026-12-01T12:00:00Z')
  const played = (minutesAgo: number, by = 'alice', byAdmin = false): ResultContext => ({
    ...pending,
    status: 'played',
    resultBy: by,
    resultByAdmin: byAdmin,
    resultFirstAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  })

  it('match à jouer : les deux joueurs et l’admin', () => {
    expect(resultRights(pending, alice, 'in_progress', now).canEdit).toBe(true)
    expect(resultRights(pending, bob, 'in_progress', now).canEdit).toBe(true)
    expect(resultRights(pending, admin, 'in_progress', now).canEdit).toBe(true)
    expect(resultRights(pending, spectator, 'in_progress', now)).toEqual({ canEdit: false, reason: null })
    expect(resultRights(pending, { ...alice, playerId: 'pc' }, 'in_progress', now)).toEqual({ canEdit: false, reason: null })
  })

  it('correction : l’auteur pendant 5 minutes, puis l’admin seul', () => {
    expect(resultRights(played(2), alice, 'in_progress', now)).toMatchObject({ canEdit: true })
    expect(resultRights(played(2), bob, 'in_progress', now)).toMatchObject({ canEdit: false, reason: expect.stringMatching(/adversaire/) })
    expect(resultRights(played(6), alice, 'in_progress', now)).toMatchObject({ canEdit: false, reason: expect.stringMatching(/5 minutes/) })
    expect(resultRights(played(1, 'sim', true), alice, 'in_progress', now)).toMatchObject({
      canEdit: false,
      reason: expect.stringMatching(/admin/),
    })
    expect(resultRights(played(60), admin, 'in_progress', now).canEdit).toBe(true)
  })

  it('tournoi terminé : admin seul ; joueurs inconnus : personne', () => {
    expect(resultRights(pending, alice, 'finished', now).canEdit).toBe(false)
    expect(resultRights(pending, admin, 'finished', now).canEdit).toBe(true)
    expect(resultRights({ ...pending, awayPlayerId: null }, admin, 'in_progress', now).canEdit).toBe(false)
  })
})
