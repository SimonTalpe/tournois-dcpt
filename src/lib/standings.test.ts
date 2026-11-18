import { describe, expect, it } from 'vitest'
import { computePoolStanding, finalStandings, groupKey, type StandingMatch } from './standings.ts'

/** Match de mini-pong joué ; sets donnés du point de vue de `home`. */
const mp = (home: string, away: string, sets: [number, number][]): StandingMatch => {
  const homeSets = sets.filter(([h, a]) => h > a).length
  return {
    home,
    away,
    status: 'played',
    winner: homeSets > sets.length / 2 ? home : away,
    sets: sets.map(([h, a]) => ({ home: h, away: a })),
  }
}
const darts = (home: string, away: string, winner: string): StandingMatch => ({
  home,
  away,
  status: 'played',
  winner,
  sets: [],
})
const order = (result: ReturnType<typeof computePoolStanding>) => result.rows.map((r) => r.playerId)
const ranks = (result: ReturnType<typeof computePoolStanding>) => result.rows.map((r) => r.rank)

describe('classement de poule — mini-pong', () => {
  it('classe au nombre de victoires et compte sets et points', () => {
    const result = computePoolStanding(
      ['a', 'b', 'c'],
      [
        mp('a', 'b', [
          [11, 5],
          [11, 7],
        ]),
        mp('a', 'c', [
          [11, 9],
          [8, 11],
          [11, 2],
        ]),
        mp('b', 'c', [
          [11, 3],
          [11, 4],
        ]),
      ],
      'mini_pong',
      2,
    )
    expect(order(result)).toEqual(['a', 'b', 'c'])
    expect(ranks(result)).toEqual([1, 2, 3])
    expect(result.complete).toBe(true)
    expect(result.rows[0]).toMatchObject({ played: 2, wins: 2, losses: 0, setsFor: 4, setsAgainst: 1, pointsFor: 52, pointsAgainst: 34 })
  })

  it('confrontation directe prioritaire sur la différence de sets', () => {
    // a et b : 2 victoires ; a a battu b mais b a une meilleure différence de sets.
    const result = computePoolStanding(
      ['a', 'b', 'c', 'd'],
      [
        mp('a', 'b', [
          [11, 9],
          [11, 9],
        ]),
        mp('c', 'a', [
          [11, 0],
          [11, 0],
        ]),
        mp('a', 'd', [
          [11, 9],
          [9, 11],
          [11, 9],
        ]),
        mp('b', 'c', [
          [11, 0],
          [11, 0],
        ]),
        mp('b', 'd', [
          [11, 0],
          [11, 0],
        ]),
        mp('d', 'c', [
          [11, 0],
          [11, 0],
        ]),
      ],
      'mini_pong',
      2,
    )
    expect(result.rows.find((r) => r.playerId === 'b')?.setsFor).toBe(4)
    expect(order(result).slice(0, 2)).toEqual(['a', 'b'])
  })

  it('cycle de confrontations directes : différence de sets', () => {
    // a, b, c : 2 victoires chacun (a>b, b>c, c>a) ; d : 0.
    const result = computePoolStanding(
      ['a', 'b', 'c', 'd'],
      [
        mp('a', 'b', [
          [11, 5],
          [11, 5],
        ]),
        mp('b', 'c', [
          [11, 5],
          [5, 11],
          [11, 5],
        ]),
        mp('c', 'a', [
          [11, 5],
          [5, 11],
          [11, 5],
        ]),
        mp('a', 'd', [
          [11, 0],
          [11, 0],
        ]),
        mp('b', 'd', [
          [11, 0],
          [11, 0],
        ]),
        mp('c', 'd', [
          [11, 0],
          [11, 0],
        ]),
      ],
      'mini_pong',
      2,
    )
    // Confrontations à égalité (1 chacun) → sets : a 5-2 (+3), c 5-3 (+2), b 4-3 (+1).
    expect(order(result)).toEqual(['a', 'c', 'b', 'd'])
    expect(result.pendingTies).toEqual([])
  })

  it('confrontation directe entre deux joueurs à égalité de victoires', () => {
    const result = computePoolStanding(
      ['a', 'b', 'c'],
      [
        mp('a', 'b', [
          [11, 9],
          [11, 9],
        ]),
        mp('b', 'c', [
          [11, 0],
          [11, 0],
        ]),
        mp('c', 'a', [
          [11, 9],
          [11, 9],
        ]),
      ],
      'mini_pong',
      1,
    )
    // Les 3 ont 1 victoire ; confrontations : 1 chacun ; sets : b +2, a 0, c -2.
    expect(order(result)).toEqual(['b', 'a', 'c'])
  })

  it('égalité parfaite à la limite des qualifiés : départage demandé, puis appliqué', () => {
    const matches = [
      mp('a', 'b', [
        [11, 9],
        [9, 11],
        [11, 9],
      ]),
      mp('b', 'c', [
        [11, 9],
        [9, 11],
        [11, 9],
      ]),
      mp('c', 'a', [
        [11, 9],
        [9, 11],
        [11, 9],
      ]),
    ]
    const tied = computePoolStanding(['a', 'b', 'c'], matches, 'mini_pong', 1)
    expect(ranks(tied)).toEqual([1, 1, 1])
    expect(tied.pendingTies).toEqual([['a', 'b', 'c']])

    const resolved = computePoolStanding(
      ['a', 'b', 'c'],
      matches,
      'mini_pong',
      1,
      new Map([[groupKey(['c', 'a', 'b']), { ranking: ['c', 'a', 'b'] }]]),
    )
    expect(order(resolved)).toEqual(['c', 'a', 'b'])
    expect(ranks(resolved)).toEqual([1, 2, 3])
    expect(resolved.rows.every((r) => r.byTiebreak)).toBe(true)
    expect(resolved.pendingTies).toEqual([])
  })
})

describe('classement de poule — fléchettes', () => {
  const pool = ['a', 'b', 'c', 'd']
  const matches = [
    darts('a', 'b', 'a'),
    darts('c', 'd', 'c'),
    darts('a', 'c', 'c'),
    darts('b', 'd', 'b'),
    darts('a', 'd', 'a'),
    darts('b', 'c', 'b'),
  ]
  // Victoires : a 2, b 2, c 2, d 0.

  it('égalité de victoires chevauchant les qualifiés : partie de départage demandée', () => {
    const result = computePoolStanding(pool, matches, 'darts', 2)
    expect(result.pendingTies).toEqual([['a', 'b', 'c']])
    expect(ranks(result)).toEqual([1, 1, 1, 4])
  })

  it('égalité hors de la limite des qualifiés : ex aequo, pas de départage', () => {
    expect(computePoolStanding(pool, matches, 'darts', 3).pendingTies).toEqual([])
  })

  it('départage saisi : classement complet appliqué', () => {
    const result = computePoolStanding(pool, matches, 'darts', 2, new Map([[groupKey(['a', 'b', 'c']), { ranking: ['b', 'c', 'a'] }]]))
    expect(order(result)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('départage d’un ancien groupe ignoré si l’égalité a changé', () => {
    const result = computePoolStanding(pool, matches, 'darts', 2, new Map([[groupKey(['a', 'b']), { ranking: ['b', 'a'] }]]))
    expect(result.pendingTies).toEqual([['a', 'b', 'c']])
  })

  it('poule incomplète : classement provisoire, pas de départage demandé', () => {
    const result = computePoolStanding(pool, [...matches.slice(0, 5), { ...matches[5], status: 'pending', winner: null }], 'darts', 2)
    expect(result.complete).toBe(false)
    expect(result.pendingTies).toEqual([])
  })

  it('match annulé ignoré, forfait compté comme victoire', () => {
    const result = computePoolStanding(
      ['a', 'b', 'c'],
      [
        { home: 'a', away: 'b', status: 'walkover', winner: 'b', sets: [] },
        { home: 'a', away: 'c', status: 'cancelled', winner: null, sets: [] },
        darts('b', 'c', 'c'),
      ],
      'darts',
      1,
    )
    expect(result.complete).toBe(true)
    expect(result.rows.find((r) => r.playerId === 'a')).toMatchObject({ played: 1, wins: 0 })
  })
})

describe('finalStandings', () => {
  it('liste les poules incomplètes ou à départager', () => {
    const complete = computePoolStanding(['a', 'b'], [darts('a', 'b', 'a')], 'darts', 1)
    const incomplete = computePoolStanding(['c', 'd'], [{ ...darts('c', 'd', 'c'), status: 'pending', winner: null }], 'darts', 1)
    expect(finalStandings([{ label: 'A', result: complete }])).toEqual({
      ok: true,
      standings: [{ label: 'A', rankedPlayerIds: ['a', 'b'] }],
    })
    expect(
      finalStandings([
        { label: 'A', result: complete },
        { label: 'B', result: incomplete },
      ]),
    ).toEqual({ ok: false, problems: ['Poule B : tous les matchs ne sont pas joués.'] })
  })
})
