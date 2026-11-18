// Joue des milliers de tableaux jusqu'au bout (vainqueurs au hasard) : aucun match ne doit rester bloqué
// et aucune place ne doit être alimentée deux fois.
import { describe, expect, it } from 'vitest'
import { buildFinalPhase, buildLaunchDraw, validateDrawConfig } from './plan.ts'
import { seededRng } from './random.ts'
import type { DrawPlan } from './types.ts'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
function simulate(plan: DrawPlan, rng: () => number) {
  // Joue tout le tableau : vérifie que chaque match finit avec 2 joueurs (ou exempt) et que tout se remplit.
  const byKey = new Map(plan.matches.map((m) => [m.key, { ...m }]))
  const placed = (key: string, slot: 'home' | 'away', p: string) => {
    const t = byKey.get(key)!
    if (t[slot]) throw new Error(`place déjà prise ${key}:${slot}`)
    t[slot] = p
  }
  const order = [...byKey.values()].filter((m) => m.poolLabel === null)
  const roundOrder = (k: string) => {
    const [b, r] = k.split('-')
    return ({ main: 0, third_place: 1, consolation: 2 } as Record<string, number>)[b] * 100 + Number(r)
  }
  // Ordre de jeu : main tour par tour, la consolante en parallèle (rangée après) — itère jusqu'à stabilité.
  let progress = true
  const done = new Set<string>()
  // pré-propagation des exempts déjà résolus
  for (const m of order) if (m.status === 'bye' && m.winner) done.add(m.key)
  while (progress) {
    progress = false
    for (const m of [...byKey.values()].filter((x) => x.poolLabel === null).sort((a, b) => roundOrder(a.roundKey) - roundOrder(b.roundKey))) {
      if (done.has(m.key)) continue
      if (m.status === 'bye') {
        if (m.home) { if (m.next) placed(m.next.matchKey, m.next.slot, m.home); done.add(m.key); progress = true }
        continue
      }
      if (!m.home || !m.away) continue
      const [w, l] = rng() < 0.5 ? [m.home, m.away] : [m.away, m.home]
      if (m.next) placed(m.next.matchKey, m.next.slot, w)
      if (m.loserNext) placed(m.loserNext.matchKey, m.loserNext.slot, l)
      done.add(m.key); progress = true
    }
  }
  const stuck = [...byKey.values()].filter((m) => m.poolLabel === null && !done.has(m.key))
  return stuck.map((m) => m.key)
}

describe('simulation de tournois complets', () => {
  it('élimination directe 2..64 joueurs : tout le tableau se joue jusqu’au bout', () => {
    for (let n = 2; n <= 64; n++) for (let s = 0; s < 8; s++) {
      for (const [third, cons] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const { plan } = buildLaunchDraw(ids(n), { format: 'knockout', poolCount: null, qualifiersPerPool: null, thirdPlace: third, consolation: cons }, seededRng(n * 1000 + s))
        expect(simulate(plan, seededRng(s))).toEqual([])
      }
    }
  })
  it('phase finale : toutes combinaisons poules (1..8) × qualifiés (1..4) × tailles 2..6', () => {
    for (let k = 1; k <= 8; k++) for (let q = 1; q <= 4; q++) for (let size = 2; size <= 6; size++) {
      const n = k * size
      if (validateDrawConfig({ format: 'pools_knockout', poolCount: k, qualifiersPerPool: q, thirdPlace: true, consolation: true }, n)) continue
      const launch = buildLaunchDraw(ids(n), { format: 'pools_knockout', poolCount: k, qualifiersPerPool: q, thirdPlace: true, consolation: true }, seededRng(n))
      const st = launch.plan.pools.map((p) => ({ label: p.label, rankedPlayerIds: p.playerIds }))
      for (const placement of ['classic', 'random'] as const) {
        const { plan } = buildFinalPhase(st, { qualifiersPerPool: q, thirdPlace: true, consolation: true, placement }, seededRng(k + q))
        expect(simulate(plan, seededRng(1))).toEqual([])
      }
    }
  })
})
