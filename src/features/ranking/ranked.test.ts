import { describe, expect, it } from 'vitest'
import { parseRankedScore, rankedRights, rankedScoreLabel } from './ranked.ts'

const NOW = new Date('2026-11-24T12:00:00Z')
const match = (hoursAgo: number, extra: Partial<{ created_by: string; created_by_admin: boolean }> = {}) => ({
  created_by: 'alice',
  created_by_admin: false,
  played_at: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
  ...extra,
})

describe('droits sur un match classé', () => {
  it('l’auteur corrige pendant 24 h', () => {
    expect(rankedRights(match(23), { isAdmin: false, profileId: 'alice' }, NOW).canEdit).toBe(true)
    expect(rankedRights(match(25), { isAdmin: false, profileId: 'alice' }, NOW)).toEqual({
      canEdit: false,
      reason: 'Délai de correction de 24 heures dépassé : contacte l’admin.',
    })
  })

  it('l’adversaire ne corrige pas ; l’admin toujours', () => {
    expect(rankedRights(match(1), { isAdmin: false, profileId: 'bob' }, NOW).canEdit).toBe(false)
    expect(rankedRights(match(100), { isAdmin: true, profileId: 'sim' }, NOW).canEdit).toBe(true)
  })

  it('saisie de l’admin pour d’autres : non modifiable par les joueurs', () => {
    expect(rankedRights(match(1, { created_by_admin: true }), { isAdmin: false, profileId: 'alice' }, NOW).canEdit).toBe(false)
  })
})

describe('saisie du score', () => {
  it('mini-pong : 1 set de 11, 2 points d’écart', () => {
    expect(parseRankedScore({ discipline: 'mini_pong', home: '11', away: '8' })).toEqual({
      score: { home: 11, away: 8 },
      winner: 'home',
    })
    expect(parseRankedScore({ discipline: 'mini_pong', home: '12', away: '14' })).toMatchObject({ winner: 'away' })
    expect(parseRankedScore({ discipline: 'mini_pong', home: '11', away: '10' })).toHaveProperty('error')
    expect(parseRankedScore({ discipline: 'mini_pong', home: '', away: '10' })).toHaveProperty('error')
  })

  it('fléchettes : vainqueur obligatoire, reste du perdant facultatif (1 à 301)', () => {
    expect(parseRankedScore({ discipline: 'darts', winner: null, loserRemaining: '' })).toHaveProperty('error')
    expect(parseRankedScore({ discipline: 'darts', winner: 'away', loserRemaining: '' })).toEqual({
      score: { winner: 'away', loser_remaining: null },
      winner: 'away',
    })
    expect(parseRankedScore({ discipline: 'darts', winner: 'home', loserRemaining: '47' })).toMatchObject({
      score: { winner: 'home', loser_remaining: 47 },
    })
    expect(parseRankedScore({ discipline: 'darts', winner: 'home', loserRemaining: '0' })).toHaveProperty('error')
    expect(parseRankedScore({ discipline: 'darts', winner: 'home', loserRemaining: '302' })).toHaveProperty('error')
  })

  it('score affiché selon le point de vue', () => {
    const m = {
      discipline: 'mini_pong' as const,
      home_player_id: 'a',
      winner_player_id: 'b',
      home_points: 9,
      away_points: 11,
      loser_remaining: null,
    }
    expect(rankedScoreLabel(m)).toBe('9 – 11')
    expect(rankedScoreLabel(m, 'b')).toBe('11 – 9')
    expect(rankedScoreLabel({ ...m, discipline: 'darts', home_points: null, away_points: null, loser_remaining: 47 })).toBe(
      'reste 47',
    )
  })
})
