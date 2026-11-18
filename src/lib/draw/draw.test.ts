import { describe, expect, it } from 'vitest'
import { bracketOrder, buildBracket, meetingRound, nextPowerOfTwo, roundName } from './bracket.ts'
import { buildFinalPhase, buildLaunchDraw, classicSeeding, randomSeeding, validateDrawConfig, type DrawConfig } from './plan.ts'
import { buildPoolMatches, drawPools, roundRobin } from './pools.ts'
import { seededRng, shuffle } from './random.ts'
import type { DrawPlan, PlanMatch } from './types.ts'

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
const knockout: DrawConfig = { format: 'knockout', poolCount: null, qualifiersPerPool: null, thirdPlace: false, consolation: false }

/** Vérifications de cohérence communes à tous les plans. */
function checkPlanIntegrity(plan: DrawPlan) {
  const keys = new Set(plan.matches.map((m) => m.key))
  expect(keys.size).toBe(plan.matches.length)
  const roundKeys = new Set(plan.rounds.map((r) => r.key))
  expect(roundKeys.size).toBe(plan.rounds.length)
  const incoming = new Map<string, number>()
  for (const m of plan.matches) {
    expect(roundKeys.has(m.roundKey)).toBe(true)
    if (m.home && m.away) expect(m.home).not.toBe(m.away)
    for (const link of [m.next, m.loserNext]) {
      if (!link) continue
      expect(keys.has(link.matchKey)).toBe(true)
      const id = `${link.matchKey}:${link.slot}`
      incoming.set(id, (incoming.get(id) ?? 0) + 1)
    }
  }
  // Une place de match n'est alimentée que par un seul lien.
  for (const count of incoming.values()) expect(count).toBe(1)
}

const round = (plan: DrawPlan, key: string) => plan.matches.filter((m) => m.roundKey === key)

describe('outils de tableau', () => {
  it('puissance de 2 supérieure', () => {
    expect([1, 2, 3, 5, 8, 9, 15, 16, 17].map(nextPowerOfTwo)).toEqual([1, 2, 4, 8, 8, 16, 16, 16, 32])
  })

  it('ordre classique des têtes de série', () => {
    expect(bracketOrder(2)).toEqual([1, 2])
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3])
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(() => bracketOrder(6)).toThrow()
  })

  it('tour de rencontre de deux places', () => {
    expect(meetingRound(0, 1)).toBe(1)
    expect(meetingRound(0, 3)).toBe(2)
    expect(meetingRound(0, 7)).toBe(3)
    expect(meetingRound(5, 6)).toBe(2)
  })

  it('noms des tours', () => {
    expect(roundName('main', 1)).toBe('Finale')
    expect(roundName('main', 2)).toBe('Demi-finales')
    expect(roundName('main', 4)).toBe('Quarts de finale')
    expect(roundName('main', 8)).toBe('8es de finale')
    expect(roundName('consolation', 2)).toBe('Consolante — demi-finales')
  })

  it('mélange reproductible et complet', () => {
    const a = shuffle(players(10), seededRng(1))
    expect(shuffle(players(10), seededRng(1))).toEqual(a)
    expect([...a].sort()).toEqual(players(10).sort())
  })
})

describe('tableau à élimination directe', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17])('%i joueurs : structure cohérente', (n) => {
    const { plan } = buildLaunchDraw(players(n), knockout, seededRng(n))
    checkPlanIntegrity(plan)
    const size = nextPowerOfTwo(n)
    expect(plan.rounds).toHaveLength(Math.log2(size))
    expect(plan.matches).toHaveLength(size - 1)
    const first = round(plan, 'main-1')
    // Chaque joueur une seule fois au 1er tour
    const placed = first.flatMap((m) => [m.home, m.away]).filter(Boolean)
    expect([...placed].sort()).toEqual(players(n).sort())
    // Exempts : taille − n, jamais deux exempts face à face
    const byes = first.filter((m) => m.status === 'bye')
    expect(byes).toHaveLength(size - n)
    for (const bye of byes) {
      expect(bye.home).not.toBeNull()
      expect(bye.away).toBeNull()
      expect(bye.winner).toBe(bye.home)
    }
    expect(plan.matches.find((m) => m.roundKey === `main-${Math.log2(size)}`)?.next).toBeNull()
  })

  it('un exempt est directement placé au tour suivant', () => {
    const { plan } = buildLaunchDraw(players(5), knockout, seededRng(3))
    const byKey = new Map(plan.matches.map((m) => [m.key, m]))
    for (const bye of round(plan, 'main-1').filter((m) => m.status === 'bye')) {
      const next = byKey.get(bye.next!.matchKey)!
      expect(next[bye.next!.slot]).toBe(bye.winner)
    }
  })

  it('exempts répartis : deux exemptés ne se rencontrent pas au 2e tour quand c’est évitable', () => {
    // 12 joueurs, tableau de 16 : 4 exempts, un par quart du tableau
    const { plan } = buildLaunchDraw(players(12), knockout, seededRng(7))
    const byePositions = round(plan, 'main-1')
      .filter((m) => m.status === 'bye')
      .map((m) => m.position)
    expect(byePositions.map((p) => Math.ceil(p / 2)).length).toBe(new Set(byePositions.map((p) => Math.ceil(p / 2))).size)
  })

  it('domicile et extérieur sont variés', () => {
    const { plan } = buildLaunchDraw(players(16), knockout, seededRng(11))
    const slots = round(plan, 'main-1').map((m) => m.next!.slot)
    expect(slots).toContain('home')
    expect(slots).toContain('away')
  })

  it('tirage différent selon le hasard', () => {
    const a = buildLaunchDraw(players(8), knockout, seededRng(1)).plan
    const b = buildLaunchDraw(players(8), knockout, seededRng(2)).plan
    expect(round(a, 'main-1').map((m) => m.home)).not.toEqual(round(b, 'main-1').map((m) => m.home))
  })

  it('refuse les doublons et moins de 2 joueurs', () => {
    expect(() => buildLaunchDraw(['p1'], knockout)).toThrow()
    expect(() => buildLaunchDraw(['p1', 'p1'], knockout)).toThrow()
  })
})

describe('match pour la 3e place', () => {
  it('perdants des demi-finales', () => {
    const { plan, notes } = buildLaunchDraw(players(6), { ...knockout, thirdPlace: true }, seededRng(5))
    checkPlanIntegrity(plan)
    expect(notes).toEqual([])
    const semis = round(plan, 'main-2')
    expect(semis.map((m) => m.loserNext?.matchKey)).toEqual(['third_place-1-1', 'third_place-1-1'])
    expect(new Set(semis.map((m) => m.loserNext?.slot)).size).toBe(2)
  })

  it('impossible à 3 joueurs', () => {
    const { plan, notes } = buildLaunchDraw(players(3), { ...knockout, thirdPlace: true }, seededRng(5))
    expect(plan.rounds.some((r) => r.bracket === 'third_place')).toBe(false)
    expect(notes[0]).toMatch(/3e place/)
  })
})

describe('consolante (élimination directe)', () => {
  it('15 joueurs : les 7 perdants du 1er tour', () => {
    const { plan } = buildLaunchDraw(players(15), { ...knockout, consolation: true, thirdPlace: true }, seededRng(9))
    checkPlanIntegrity(plan)
    const realFirstRound = round(plan, 'main-1').filter((m) => m.status === 'pending')
    expect(realFirstRound).toHaveLength(7)
    for (const m of realFirstRound) expect(m.loserNext?.matchKey).toMatch(/^consolation-1-/)
    const consolationFirst = round(plan, 'consolation-1')
    expect(consolationFirst).toHaveLength(4)
    // 7 perdants dans un tableau de 8 : un exempt, en attente de son joueur
    const bye = consolationFirst.filter((m) => m.status === 'bye')
    expect(bye).toHaveLength(1)
    expect(bye[0].home).toBeNull()
    expect(bye[0].winner).toBeNull()
    // Les exemptés du tableau principal ne vont pas en consolante
    for (const m of round(plan, 'main-1').filter((m) => m.status === 'bye')) expect(m.loserNext).toBeNull()
  })

  it('8 joueurs : 4 perdants', () => {
    const { plan } = buildLaunchDraw(players(8), { ...knockout, consolation: true }, seededRng(2))
    checkPlanIntegrity(plan)
    expect(plan.rounds.filter((r) => r.bracket === 'consolation').map((r) => r.name)).toEqual([
      'Consolante — demi-finales',
      'Consolante — finale',
    ])
  })

  it('9 joueurs : un seul perdant au 1er tour → pas de consolante', () => {
    const { plan, notes } = buildLaunchDraw(players(9), { ...knockout, consolation: true }, seededRng(2))
    expect(plan.rounds.some((r) => r.bracket === 'consolation')).toBe(false)
    expect(notes).toHaveLength(1)
  })

  it('4 joueurs avec 3e place : pas de consolante (doublon)', () => {
    const { plan, notes } = buildLaunchDraw(players(4), { ...knockout, consolation: true, thirdPlace: true }, seededRng(2))
    checkPlanIntegrity(plan)
    expect(plan.rounds.some((r) => r.bracket === 'consolation')).toBe(false)
    expect(notes).toHaveLength(1)
  })
})

describe('poules', () => {
  it('répartition équilibrée (15 joueurs, 4 poules → 4, 4, 4, 3)', () => {
    const pools = drawPools(players(15), 4, seededRng(1))
    expect(pools.map((p) => p.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(pools.map((p) => p.playerIds.length)).toEqual([4, 4, 4, 3])
    expect(pools.flatMap((p) => p.playerIds).sort()).toEqual(players(15).sort())
  })

  it.each([2, 3, 4, 5, 6])('chacun contre chacun à %i joueurs', (n) => {
    const days = roundRobin(players(n))
    const pairs = days.flat().map(([a, b]) => [a, b].sort().join('-'))
    expect(pairs).toHaveLength((n * (n - 1)) / 2)
    expect(new Set(pairs).size).toBe(pairs.length)
    // Personne ne joue deux fois la même journée
    for (const day of days) {
      const inDay = day.flat()
      expect(new Set(inDay).size).toBe(inDay.length)
    }
  })

  it('plan de lancement avec poules', () => {
    const config: DrawConfig = { format: 'pools_knockout', poolCount: 4, qualifiersPerPool: 2, thirdPlace: true, consolation: true }
    const { plan } = buildLaunchDraw(players(15), config, seededRng(4))
    checkPlanIntegrity(plan)
    expect(plan.pools).toHaveLength(4)
    expect(plan.rounds).toEqual([{ key: 'pool-1', bracket: 'pool', roundNumber: 1, name: 'Poules' }])
    // 3 poules de 4 (6 matchs) + 1 poule de 3 (3 matchs)
    expect(plan.matches).toHaveLength(21)
    expect(plan.matches.map((m) => m.position)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
    for (const m of plan.matches) {
      const pool = plan.pools.find((p) => p.label === m.poolLabel)!
      expect(pool.playerIds).toContain(m.home)
      expect(pool.playerIds).toContain(m.away)
    }
  })

  it('matchs classés par journée', () => {
    const pools = drawPools(players(8), 2, seededRng(1))
    const { matches } = buildPoolMatches(pools, seededRng(1))
    // Journée 1 : 2 matchs de A puis 2 de B
    expect(matches.slice(0, 4).map((m: PlanMatch) => m.poolLabel)).toEqual(['A', 'A', 'B', 'B'])
  })
})

describe('validation de la configuration', () => {
  const pools = (poolCount: number, qualifiersPerPool: number): DrawConfig => ({
    format: 'pools_knockout',
    poolCount,
    qualifiersPerPool,
    thirdPlace: false,
    consolation: false,
  })
  it('cas valides', () => {
    expect(validateDrawConfig(knockout, 2)).toBeNull()
    expect(validateDrawConfig(pools(4, 2), 15)).toBeNull()
    expect(validateDrawConfig(pools(1, 4), 6)).toBeNull()
  })
  it('cas refusés', () => {
    expect(validateDrawConfig(knockout, 1)).toMatch(/au moins 2/)
    expect(validateDrawConfig(pools(8, 1), 15)).toMatch(/7 poule/)
    expect(validateDrawConfig(pools(4, 4), 15)).toMatch(/3 qualifié/)
    expect(validateDrawConfig(pools(1, 1), 4)).toMatch(/2 qualifiés/)
    expect(validateDrawConfig(pools(0, 1), 4)).toMatch(/nombre de poules/)
  })
})

describe('phase finale après poules', () => {
  const standings = (counts: number[]) =>
    counts.map((count, i) => {
      const label = String.fromCharCode(65 + i)
      return { label, rankedPlayerIds: Array.from({ length: count }, (_, r) => `${r + 1}${label}`) }
    })

  /** Matchs du 1er tour du tableau principal sous forme « X–Y » (ordre indifférent). */
  const firstRoundPairs = (plan: DrawPlan) =>
    round(plan, 'main-1').map((m) => [m.home, m.away].filter(Boolean).sort().join('–'))

  it('croisement classique, 2 poules : 1A–2B et 1B–2A', () => {
    expect(classicSeeding(standings([4, 4]), 2)).toEqual(['1A', '1B', '2A', '2B'])
    const { plan } = buildFinalPhase(standings([4, 4]), { qualifiersPerPool: 2, thirdPlace: false, consolation: false, placement: 'classic' }, seededRng(1))
    expect(firstRoundPairs(plan).sort()).toEqual(['1A–2B', '1B–2A'])
  })

  it('croisement classique, 4 poules : jamais deux joueurs de la même poule avant la finale', () => {
    const { plan } = buildFinalPhase(standings([4, 4, 4, 3]), { qualifiersPerPool: 2, thirdPlace: true, consolation: true, placement: 'classic' }, seededRng(1))
    checkPlanIntegrity(plan)
    expect(firstRoundPairs(plan).sort()).toEqual(['1A–2B', '1B–2A', '1C–2D', '1D–2C'])
    // 1A et 2A dans des moitiés opposées du tableau
    const first = round(plan, 'main-1')
    const half = (id: string) => (first.findIndex((m) => m.home === id || m.away === id) < 2 ? 'haut' : 'bas')
    for (const l of ['A', 'B', 'C', 'D']) expect(half(`1${l}`)).not.toBe(half(`2${l}`))
    expect(half('1A')).not.toBe(half('1B'))
    // Consolante : les 7 non-qualifiés, connus d'avance
    const consolationPlayers = plan.matches
      .filter((m) => m.roundKey === 'consolation-1')
      .flatMap((m) => [m.home, m.away])
      .filter(Boolean)
    expect(consolationPlayers.sort()).toEqual(['3A', '3B', '3C', '3D', '4A', '4B', '4C'].sort())
  })

  it('croisement classique, 3 poules et 2 qualifiés : exempts pour les 1ers, pas de même poule au 1er tour', () => {
    const { plan } = buildFinalPhase(standings([5, 5, 5]), { qualifiersPerPool: 2, thirdPlace: false, consolation: false, placement: 'classic' }, seededRng(1))
    checkPlanIntegrity(plan)
    const first = round(plan, 'main-1')
    expect(first.filter((m) => m.status === 'bye').map((m) => m.home).sort()).toEqual(['1A', '1B'])
    for (const pair of firstRoundPairs(plan)) {
      const [a, b] = pair.split('–')
      if (b) expect(a.slice(-1)).not.toBe(b.slice(-1))
    }
  })

  it('tirage au sort des qualifiés : pas de joueurs de la même poule au 1er tour', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const seeds = randomSeeding(standings([4, 4, 4, 4]), 2, seededRng(seed))
      expect(seeds).toHaveLength(8)
      const { plan } = buildFinalPhase(standings([4, 4, 4, 4]), { qualifiersPerPool: 2, thirdPlace: false, consolation: false, placement: 'random' }, seededRng(seed))
      for (const pair of firstRoundPairs(plan)) {
        const [a, b] = pair.split('–')
        expect(a.slice(-1)).not.toBe(b.slice(-1))
      }
    }
  })

  it('classements incomplets refusés', () => {
    expect(() =>
      buildFinalPhase(standings([1, 3]), { qualifiersPerPool: 2, thirdPlace: false, consolation: false, placement: 'classic' }),
    ).toThrow()
  })
})

describe('tableau générique', () => {
  it('consolante avec joueurs connus : exempts qualifiés directement', () => {
    const built = buildBracket(
      ['a', 'b', 'c'].map((playerId) => ({ kind: 'player' as const, playerId })),
      'consolation',
      seededRng(1),
    )
    expect(built.feederLinks).toEqual([])
    const final = built.matches.find((m) => m.key === 'consolation-2-1')!
    expect([final.home, final.away]).toContain('a')
  })
})

describe('robustesse (toutes tailles, plusieurs tirages)', () => {
  it('élimination directe 2 à 32 joueurs, toutes options', () => {
    for (let n = 2; n <= 32; n++) {
      for (let seed = 1; seed <= 5; seed++) {
        const { plan } = buildLaunchDraw(players(n), { ...knockout, thirdPlace: true, consolation: true }, seededRng(n * 100 + seed))
        checkPlanIntegrity(plan)
      }
    }
  })

  it('phase finale : 1 à 6 poules, 1 à 3 qualifiés', () => {
    for (let pools = 1; pools <= 6; pools++) {
      for (let q = 1; q <= 3; q++) {
        if (pools * q < 2) continue
        const s = Array.from({ length: pools }, (_, i) => {
          const label = String.fromCharCode(65 + i)
          return { label, rankedPlayerIds: Array.from({ length: 4 }, (_, r) => `${r + 1}${label}`) }
        })
        for (const placement of ['classic', 'random'] as const) {
          const { plan } = buildFinalPhase(s, { qualifiersPerPool: q, thirdPlace: true, consolation: true, placement }, seededRng(pools * 10 + q))
          checkPlanIntegrity(plan)
          const main = plan.matches.filter((m) => m.roundKey === 'main-1').flatMap((m) => [m.home, m.away]).filter(Boolean)
          expect(main).toHaveLength(pools * q)
        }
      }
    }
  })
})
