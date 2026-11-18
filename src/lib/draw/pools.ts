import { coinFlip, shuffle } from './random.ts'
import type { PlanMatch, PlanPool, PlanRound, Rng } from './types.ts'

export const POOL_ROUND_KEY = 'pool-1'

export function poolLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * Tirage au sort des poules : joueurs mélangés puis distribués une à une
 * (les poules diffèrent au plus d'un joueur : 15 joueurs en 4 poules → 4, 4, 4, 3).
 */
export function drawPools(playerIds: readonly string[], poolCount: number, rng: Rng): PlanPool[] {
  if (poolCount < 1) throw new Error('Il faut au moins une poule')
  if (playerIds.length < poolCount * 2) throw new Error('Pas assez de joueurs pour ce nombre de poules')
  const pools: PlanPool[] = Array.from({ length: poolCount }, (_, i) => ({ label: poolLabel(i), playerIds: [] }))
  shuffle(playerIds, rng).forEach((id, i) => pools[i % poolCount].playerIds.push(id))
  return pools
}

/**
 * Calendrier « chacun contre chacun » (méthode du cercle) : liste des journées, chacune avec ses rencontres.
 * Nombre impair de joueurs : un joueur est au repos à chaque journée.
 */
export function roundRobin(playerIds: readonly string[]): [string, string][][] {
  const players: (string | null)[] = [...playerIds]
  if (players.length % 2 === 1) players.push(null)
  const n = players.length
  const days: [string, string][][] = []
  for (let day = 0; day < n - 1; day++) {
    const pairs: [string, string][] = []
    for (let i = 0; i < n / 2; i++) {
      const a = players[i]
      const b = players[n - 1 - i]
      if (a && b) pairs.push([a, b])
    }
    days.push(pairs)
    // Rotation : le premier reste fixe, les autres tournent.
    players.splice(1, 0, players.pop() as string | null)
  }
  return days
}

/** Tour « Poules » et ses matchs, classés par journée puis par poule. Domicile/extérieur au hasard. */
export function buildPoolMatches(pools: readonly PlanPool[], rng: Rng): { round: PlanRound; matches: PlanMatch[] } {
  const round: PlanRound = { key: POOL_ROUND_KEY, bracket: 'pool', roundNumber: 1, name: 'Poules' }
  const schedules = pools.map((pool) => ({ label: pool.label, days: roundRobin(pool.playerIds) }))
  const maxDays = Math.max(...schedules.map((s) => s.days.length))
  const matches: PlanMatch[] = []
  const counters = new Map<string, number>()
  for (let day = 0; day < maxDays; day++) {
    for (const schedule of schedules) {
      for (const [a, b] of schedule.days[day] ?? []) {
        const index = (counters.get(schedule.label) ?? 0) + 1
        counters.set(schedule.label, index)
        const [home, away] = coinFlip(rng) ? [a, b] : [b, a]
        matches.push({
          key: `pool-${schedule.label}-${index}`,
          roundKey: round.key,
          poolLabel: schedule.label,
          position: matches.length + 1,
          home,
          away,
          status: 'pending',
          winner: null,
          next: null,
          loserNext: null,
        })
      }
    }
  }
  return { round, matches }
}
