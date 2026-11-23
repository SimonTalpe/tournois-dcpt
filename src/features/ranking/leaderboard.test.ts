import { describe, expect, it } from 'vitest'
import { buildLeaderboard, currentStreak, formatDelta, playerElo, ratingSeries, type EloHistoryRow } from './leaderboard.ts'

const NOW = new Date('2026-11-30T12:00:00Z')

/** Historique d'un joueur : résultats (true = victoire) et écarts, avec des dates données en jours avant NOW. */
function history(
  id: string,
  matches: { won: boolean; delta: number; daysAgo: number }[],
  status: EloHistoryRow['account_status'] = 'active',
): EloHistoryRow[] {
  let rating = 1200
  return matches.map((m, i) => {
    const row: EloHistoryRow = {
      player_id: id,
      profile_id: `profile-${id}`,
      full_name: id,
      account_status: status,
      seq: i + 1,
      source: 'ranked',
      match_id: `${id}-${i}`,
      played_at: new Date(NOW.getTime() - m.daysAgo * 86400_000).toISOString(),
      opponent_player_id: 'x',
      opponent_name: 'X',
      won: m.won,
      rating_before: rating,
      rating_after: rating + m.delta,
      delta: m.delta,
    }
    rating += m.delta
    return row
  })
}

const w = (delta: number, daysAgo = 1) => ({ won: true, delta, daysAgo })
const l = (delta: number, daysAgo = 1) => ({ won: false, delta: -delta, daysAgo })

describe('leaderboard', () => {
  it('séries en cours', () => {
    expect(currentStreak([])).toBe(0)
    expect(currentStreak([false, true, true, true])).toBe(3)
    expect(currentStreak([true, false, false])).toBe(-2)
  })

  it('statistiques d’un joueur', () => {
    const stats = playerElo(history('ana', [w(20), w(18), l(22), w(19)]))
    expect(stats).toMatchObject({ rating: 1235, games: 4, wins: 3, losses: 1, winRate: 75, streak: 1, best: 1238 })
    expect(playerElo([])).toBeNull()
  })

  it('classés après 3 matchs, triés par Elo, ex æquo à Elo égal', () => {
    const board = buildLeaderboard(
      [
        ...history('ana', [w(20), w(18), w(16)]),
        ...history('bob', [w(20), l(20), w(20)]),
        ...history('cid', [w(20), w(20), l(20)]),
        ...history('dan', [w(20), w(20)]),
      ],
      NOW,
    )
    expect(board.ranked.map((e) => [e.name, e.rank])).toEqual([
      ['ana', 1],
      ['bob', 2],
      ['cid', 2],
    ])
    expect(board.provisional.map((e) => e.name)).toEqual(['dan'])
    expect(board.provisional[0].rank).toBeNull()
  })

  it('comptes désactivés, supprimés et noms seuls exclus', () => {
    const board = buildLeaderboard(
      [
        ...history('ana', [w(20), w(18), w(16)], 'disabled'),
        ...history('bob', [w(20), w(18), w(16)], 'deleted'),
        ...history('cid', [w(20), w(18), w(16)]).map((r) => ({ ...r, profile_id: null, account_status: null })),
      ],
      NOW,
    )
    expect(board.ranked).toEqual([])
    expect(board.provisional).toEqual([])
  })

  it('progression sur 7 jours', () => {
    const board = buildLeaderboard(
      [
        // Il y a 10 jours : ana 1er, bob 2e. Depuis : bob dépasse ana.
        ...history('ana', [w(20, 10), w(18, 10), w(16, 10), l(30, 2)]),
        ...history('bob', [w(20, 10), w(10, 10), w(10, 10), w(30, 2)]),
        // Classé seulement cette semaine : pas de flèche.
        ...history('cid', [w(5, 10), w(5, 2), w(5, 2)]),
      ],
      NOW,
    )
    const change = Object.fromEntries(board.ranked.map((e) => [e.name, e.rankChange]))
    expect(change).toEqual({ ana: -1, bob: 1, cid: null })
  })

  it('courbe et format des écarts', () => {
    expect(ratingSeries(history('ana', [w(20), l(10)]))).toEqual([1200, 1220, 1210])
    expect(formatDelta(14)).toBe('+14')
    expect(formatDelta(-9)).toBe('−9')
    expect(formatDelta(0)).toBe('±0')
  })
})
