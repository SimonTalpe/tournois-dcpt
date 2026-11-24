import { describe, expect, it } from 'vitest'
import { buildLaunchDraw, buildQualificationFinal, qualificationRoundName, validateDrawConfig, type DrawConfig } from './draw/plan.ts'
import { seededRng } from './draw/random.ts'
import {
  computeQualification,
  drawKey,
  expectedQualifierCount,
  preliminaryByeCount,
  type QualificationMatch,
} from './qualification.ts'

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
const config = (wins = 1, losses = 2): DrawConfig => ({
  format: 'qualification_knockout',
  poolCount: null,
  qualifiersPerPool: null,
  thirdPlace: true,
  consolation: false,
  qualification: { wins, losses },
})
const played = (home: string, away: string, homePoints: number, awayPoints: number): QualificationMatch => ({
  home,
  away,
  status: 'played',
  winner: homePoints > awayPoints ? home : away,
  sets: [{ home: homePoints, away: awayPoints }],
})

describe('nombre de qualifiés attendu', () => {
  it('1 victoire, 2 défaites', () => {
    expect(expectedQualifierCount(32, 1, 2)).toBe(24)
    expect(expectedQualifierCount(35, 1, 2)).toBe(27)
    expect([12, 13, 14, 15, 16, 17, 18].map((n) => expectedQualifierCount(n, 1, 2))).toEqual([9, 10, 11, 12, 12, 13, 14])
    expect(expectedQualifierCount(7, 1, 2)).toBe(6)
  })

  it('ronde suisse à 2 victoires', () => {
    expect(expectedQualifierCount(32, 2, 2)).toBe(16)
  })

  it('exemptés du tour préliminaire', () => {
    expect(preliminaryByeCount(24)).toBe(8)
    expect(preliminaryByeCount(27)).toBe(5)
    expect(preliminaryByeCount(16)).toBe(0)
  })
})

describe('lancement', () => {
  it('au moins 6 joueurs et des réglages valides', () => {
    expect(validateDrawConfig(config(), 5)).toMatch(/6 joueurs/)
    expect(validateDrawConfig(config(), 6)).toBeNull()
    expect(validateDrawConfig({ ...config(), qualification: { wins: 0, losses: 2 } }, 10)).toMatch(/victoires/)
  })

  it('rounds créés d’avance et round 1 tiré au sort, exempt si impair', () => {
    const { plan } = buildLaunchDraw(players(7), config(), seededRng(3))
    expect(plan.rounds.map((r) => r.name)).toEqual(['Round 1', 'Repêchage'])
    expect(plan.rounds.every((r) => r.bracket === 'qualification')).toBe(true)
    expect(plan.matches).toHaveLength(4)
    const bye = plan.matches.filter((m) => m.status === 'bye')
    expect(bye).toHaveLength(1)
    expect(bye[0].winner).toBe(bye[0].home)
    expect(new Set(plan.matches.flatMap((m) => [m.home, m.away]).filter(Boolean)).size).toBe(7)
  })

  it('noms des rounds', () => {
    expect([1, 2, 3].map((n) => qualificationRoundName(n, 1, 3))).toEqual(['Round 1', 'Repêchage 1', 'Repêchage 2'])
    expect([1, 2, 3].map((n) => qualificationRoundName(n, 2, 2))).toEqual(['Round 1', 'Round 2', 'Round 3'])
  })
})

describe('classement de la qualification', () => {
  const base = { tournamentId: 't', wins: 1, losses: 2 }

  it('statuts : qualifié, éliminé, en match, en attente', () => {
    const result = computeQualification({
      ...base,
      playerIds: players(6),
      matches: [
        played('p1', 'p2', 11, 5),
        played('p3', 'p4', 11, 9),
        { home: 'p5', away: 'p6', status: 'pending', winner: null, sets: [] },
        played('p2', 'p4', 11, 2),
      ],
    })
    const status = Object.fromEntries(result.rows.map((r) => [r.playerId, r.status]))
    expect(status).toEqual({ p1: 'qualified', p2: 'qualified', p3: 'qualified', p4: 'eliminated', p5: 'playing', p6: 'playing' })
    expect(result.complete).toBe(false)
  })

  it('qualifiés classés : défaites, puis différence, puis points marqués', () => {
    const result = computeQualification({
      ...base,
      playerIds: players(6),
      matches: [
        played('p1', 'p2', 11, 9), // p1 +2
        played('p3', 'p4', 11, 3), // p3 +8
        played('p5', 'p6', 12, 10), // p5 +2, 12 points marqués
        played('p2', 'p4', 11, 0), // p2 repêché : 1 défaite
        played('p6', 'p4', 11, 1), // (cas d'école : p4 compte 3 défaites)
      ],
    })
    expect(result.complete).toBe(true)
    expect(result.qualified.slice(0, 3)).toEqual(['p3', 'p5', 'p1'])
    // Repêchés derrière : p2 (+9 sur 2 matchs) et p6 (−2 + 10 = +8)
    expect(result.qualified.slice(3)).toEqual(['p2', 'p6'])
    expect(result.rows.find((r) => r.playerId === 'p4')?.status).toBe('eliminated')
  })

  it('égalité parfaite : tirage au sort stable, signalé', () => {
    const matches = [played('p1', 'p2', 11, 5), played('p3', 'p4', 11, 5)]
    const result = computeQualification({ ...base, playerIds: players(4), matches })
    const [first, second] = result.qualified
    expect(drawKey('t', first)).toBeLessThan(drawKey('t', second))
    expect(result.rows.filter((r) => r.tiedByDraw).map((r) => r.playerId).sort()).toEqual(['p1', 'p3'])
    expect(computeQualification({ ...base, playerIds: players(4), matches }).qualified).toEqual(result.qualified)
  })

  it('exempt : victoire sans points ; forfait : sans points', () => {
    const result = computeQualification({
      ...base,
      playerIds: players(3),
      matches: [
        { home: 'p1', away: null, status: 'bye', winner: 'p1', sets: [] },
        { home: 'p2', away: 'p3', status: 'walkover', winner: 'p2', sets: [] },
      ],
    })
    const p1 = result.rows.find((r) => r.playerId === 'p1')
    expect(p1).toMatchObject({ wins: 1, byes: 1, played: 0, pointsFor: 0, status: 'qualified' })
    expect(result.rows.find((r) => r.playerId === 'p3')).toMatchObject({ losses: 1, played: 1, status: 'waiting' })
  })

  it('fléchettes : manches', () => {
    const result = computeQualification({
      ...base,
      playerIds: players(2),
      matches: [{ home: 'p1', away: 'p2', status: 'played', winner: 'p1', sets: [], legs: { home: 2, away: 1 } }],
    })
    expect(result.rows[0]).toMatchObject({ playerId: 'p1', pointsFor: 2, pointsAgainst: 1 })
  })
})

describe('phase finale après qualification', () => {
  it('tour préliminaire : les mieux classés exemptés', () => {
    const ranked = players(24)
    const { plan } = buildQualificationFinal(ranked, { nextStage: 'preliminary', thirdPlace: true }, seededRng(1))
    const first = plan.matches.filter((m) => m.roundKey === 'main-1')
    expect(plan.rounds.find((r) => r.key === 'main-1')?.name).toBe('Tour préliminaire')
    const byes = first.filter((m) => m.status === 'bye').map((m) => m.home)
    expect(byes.sort()).toEqual(ranked.slice(0, 8).sort())
    // Le 9e joue contre le 24e, le 16e contre le 17e.
    const pair = (a: string, b: string) => first.some((m) => [m.home, m.away].sort().join() === [a, b].sort().join())
    expect(pair('p9', 'p24')).toBe(true)
    expect(pair('p16', 'p17')).toBe(true)
    expect(plan.rounds.some((r) => r.bracket === 'third_place')).toBe(true)
  })

  it('16 qualifiés : pas de tour préliminaire', () => {
    const { plan } = buildQualificationFinal(players(16), { nextStage: 'preliminary', thirdPlace: false }, seededRng(1))
    expect(plan.rounds.find((r) => r.key === 'main-1')?.name).toBe('8es de finale')
  })

  it('aucune étape : tirage au sort', () => {
    const { plan } = buildQualificationFinal(players(6), { nextStage: 'none', thirdPlace: false }, seededRng(2))
    expect(plan.matches.filter((m) => m.roundKey === 'main-1' && m.status === 'bye')).toHaveLength(2)
  })
})
