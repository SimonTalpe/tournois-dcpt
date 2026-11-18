import { bracketOrder, buildBracket, matchKey, meetingRound, nextPowerOfTwo, type Entrant } from './bracket.ts'
import { buildPoolMatches, drawPools } from './pools.ts'
import { coinFlip, shuffle } from './random.ts'
import type { DrawPlan, PlanMatch, PlanRound, Rng } from './types.ts'

export type DrawConfig = {
  format: 'knockout' | 'pools_knockout'
  poolCount: number | null
  qualifiersPerPool: number | null
  thirdPlace: boolean
  consolation: boolean
}

export type DrawResult = {
  plan: DrawPlan
  /** Remarques à afficher à l'admin (option non applicable, etc.). */
  notes: string[]
}

/** Vérifie qu'une configuration est jouable avec ce nombre de joueurs. Renvoie un message ou null. */
export function validateDrawConfig(config: DrawConfig, playerCount: number): string | null {
  if (playerCount < 2) return 'Il faut au moins 2 joueurs.'
  if (config.format === 'knockout') return null
  const pools = config.poolCount ?? 0
  const qualifiers = config.qualifiersPerPool ?? 0
  if (pools < 1) return 'Indique le nombre de poules.'
  if (pools > 16) return '16 poules au maximum.'
  if (playerCount < pools * 2) return `Avec ${playerCount} joueurs, ${Math.floor(playerCount / 2)} poule(s) au maximum (2 joueurs minimum par poule).`
  const smallestPool = Math.floor(playerCount / pools)
  if (qualifiers < 1) return 'Indique le nombre de qualifiés par poule.'
  if (qualifiers > smallestPool) return `La plus petite poule aura ${smallestPool} joueurs : ${smallestPool} qualifié(s) par poule au maximum.`
  if (qualifiers * pools < 2) return 'Il faut au moins 2 qualifiés au total pour la phase finale.'
  return null
}

/** Tableau principal + options (3e place, consolante) à partir des participants rangés par tête de série. */
function buildKnockoutPhase(
  mainSeeds: readonly string[],
  options: { thirdPlace: boolean; consolation: 'first_round_losers' | readonly string[] | null },
  rng: Rng,
): DrawResult {
  const notes: string[] = []
  const main = buildBracket(
    mainSeeds.map((playerId) => ({ kind: 'player', playerId }) satisfies Entrant),
    'main',
    rng,
  )
  const rounds: PlanRound[] = [...main.rounds]
  const matches: PlanMatch[] = [...main.matches]
  const byKey = new Map(matches.map((m) => [m.key, m]))
  const mainRoundCount = main.rounds.length

  // Match pour la 3e place : perdants des demi-finales.
  if (options.thirdPlace) {
    if (mainSeeds.length < 4) {
      notes.push('Pas de match pour la 3e place : il faut au moins 4 joueurs dans le tableau.')
    } else {
      const thirdKey = matchKey('third_place', 1, 1)
      rounds.push({ key: 'third_place-1', bracket: 'third_place', roundNumber: 1, name: 'Match pour la 3e place' })
      matches.push({
        key: thirdKey,
        roundKey: 'third_place-1',
        poolLabel: null,
        position: 1,
        home: null,
        away: null,
        status: 'pending',
        winner: null,
        next: null,
        loserNext: null,
      })
      const firstSlot = coinFlip(rng) ? 'home' : 'away'
      ;(byKey.get(matchKey('main', mainRoundCount - 1, 1)) as PlanMatch).loserNext = { matchKey: thirdKey, slot: firstSlot }
      ;(byKey.get(matchKey('main', mainRoundCount - 1, 2)) as PlanMatch).loserNext = {
        matchKey: thirdKey,
        slot: firstSlot === 'home' ? 'away' : 'home',
      }
    }
  }

  // Consolante
  if (options.consolation) {
    const semiFinalsFirst =
      options.consolation === 'first_round_losers' && options.thirdPlace && mainRoundCount === 2
    const entrants: Entrant[] = semiFinalsFirst
      ? []
      : options.consolation === 'first_round_losers'
        ? main.matches
            .filter((m) => m.roundKey === 'main-1' && m.status === 'pending')
            .map((m) => ({ kind: 'loser', matchKey: m.key }))
        : options.consolation.map((playerId) => ({ kind: 'player', playerId }))
    if (semiFinalsFirst) {
      notes.push('Pas de consolante : le 1er tour est déjà la demi-finale (les perdants jouent la 3e place).')
    } else if (entrants.length < 2) {
      notes.push('Pas de consolante : il faudrait au moins 2 joueurs à y envoyer.')
    } else {
      const consolation = buildBracket(entrants, 'consolation', rng)
      rounds.push(...consolation.rounds)
      matches.push(...consolation.matches)
      for (const { fromMatchKey, link } of consolation.feederLinks) {
        ;(byKey.get(fromMatchKey) as PlanMatch).loserNext = link
      }
    }
  }

  return { plan: { pools: [], rounds, matches }, notes }
}

/**
 * Tirage au lancement du tournoi.
 * - Élimination directe : placement entièrement au sort, exempts répartis dans le tableau.
 * - Poules puis élimination : tirage des poules et calendrier ; la phase finale est générée
 *   par l'admin à la fin des poules (buildFinalPhase).
 */
export function buildLaunchDraw(playerIds: readonly string[], config: DrawConfig, rng: Rng = Math.random): DrawResult {
  const error = validateDrawConfig(config, playerIds.length)
  if (error) throw new Error(error)
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Joueur inscrit en double')

  if (config.format === 'knockout') {
    return buildKnockoutPhase(
      shuffle(playerIds, rng),
      { thirdPlace: config.thirdPlace, consolation: config.consolation ? 'first_round_losers' : null },
      rng,
    )
  }

  const pools = drawPools(playerIds, config.poolCount as number, rng)
  const { round, matches } = buildPoolMatches(pools, rng)
  return { plan: { pools, rounds: [round], matches }, notes: [] }
}

// ---------------------------------------------------------------------------
// Phase finale (format avec poules)
// ---------------------------------------------------------------------------

export type PoolStanding = { label: string; rankedPlayerIds: string[] }

/** Coût d'un placement : deux joueurs d'une même poule qui peuvent se retrouver tôt dans le tableau. */
function samePoolCost(seedPools: readonly string[], size: number, onlyFirstRound = false): number {
  const order = bracketOrder(size)
  const slotOfSeed = new Map(order.map((seed, slot) => [seed, slot]))
  const roundCount = Math.log2(size)
  let cost = 0
  for (let a = 0; a < seedPools.length; a++) {
    for (let b = a + 1; b < seedPools.length; b++) {
      if (seedPools[a] !== seedPools[b]) continue
      const round = meetingRound(slotOfSeed.get(a + 1) as number, slotOfSeed.get(b + 1) as number)
      if (onlyFirstRound) cost += round === 1 ? 1 : 0
      else cost += 4 ** (roundCount - round)
    }
  }
  return cost
}

/**
 * Préférence de présentation à coût égal : au 1er tour, opposer les poules « partenaires »
 * (A↔B, C↔D…), comme dans le croisement habituel 1A–2B, 1B–2A.
 */
function partnerMismatches(seedPools: readonly string[], size: number): number {
  const order = bracketOrder(size)
  let mismatches = 0
  for (let i = 0; i < order.length; i += 2) {
    const a = seedPools[order[i] - 1]
    const b = seedPools[order[i + 1] - 1]
    if (!a || !b) continue
    const partner = String.fromCharCode(((a.charCodeAt(0) - 65) ^ 1) + 65)
    if (b !== partner) mismatches++
  }
  return mismatches
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  )
}

/**
 * Croisement classique : 1ers de poule en têtes de série (A, B, C…), puis les 2es, 3es…
 * placés pour que deux joueurs d'une même poule se rencontrent le plus tard possible
 * (ex. 2 poules : 1A–2B et 1B–2A, 1A et 2A ne peuvent se retrouver qu'en finale).
 */
export function classicSeeding(standings: readonly PoolStanding[], qualifiersPerPool: number): string[] {
  const total = standings.length * qualifiersPerPool
  const size = nextPowerOfTwo(total)
  const seedPools: string[] = standings.map((s) => s.label)
  const seeds: string[] = standings.map((s) => s.rankedPlayerIds[0])
  for (let rank = 1; rank < qualifiersPerPool; rank++) {
    const labels = standings.map((s) => s.label)
    const candidates = labels.length <= 7 ? permutations(labels) : [labels, [...labels].reverse()]
    let best = candidates[0]
    let bestCost = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const pools = [...seedPools, ...candidate]
      const cost = samePoolCost(pools, size) * 1000 + partnerMismatches(pools, size)
      if (cost < bestCost) {
        best = candidate
        bestCost = cost
      }
    }
    for (const label of best) {
      seedPools.push(label)
      seeds.push((standings.find((s) => s.label === label) as PoolStanding).rankedPlayerIds[rank])
    }
  }
  return seeds
}

/** Tirage au sort des qualifiés, en évitant si possible deux joueurs d'une même poule au 1er tour. */
export function randomSeeding(standings: readonly PoolStanding[], qualifiersPerPool: number, rng: Rng): string[] {
  const qualified = standings.flatMap((s) =>
    s.rankedPlayerIds.slice(0, qualifiersPerPool).map((playerId) => ({ playerId, pool: s.label })),
  )
  const size = nextPowerOfTwo(qualified.length)
  let best = shuffle(qualified, rng)
  let bestCost = samePoolCost(best.map((q) => q.pool), size, true)
  for (let attempt = 0; attempt < 200 && bestCost > 0; attempt++) {
    const candidate = shuffle(qualified, rng)
    const cost = samePoolCost(candidate.map((q) => q.pool), size, true)
    if (cost < bestCost) {
      best = candidate
      bestCost = cost
    }
  }
  return best.map((q) => q.playerId)
}

/**
 * Phase finale d'un tournoi à poules, à partir des classements de poule (générée par l'admin).
 * Consolante : les non-qualifiés des poules (les mieux classés en tête de série).
 */
export function buildFinalPhase(
  standings: readonly PoolStanding[],
  config: Pick<DrawConfig, 'qualifiersPerPool' | 'thirdPlace' | 'consolation'> & {
    placement: 'classic' | 'random'
  },
  rng: Rng = Math.random,
): DrawResult {
  const q = config.qualifiersPerPool ?? 0
  if (q < 1 || standings.some((s) => s.rankedPlayerIds.length < q)) {
    throw new Error('Classements de poule incomplets')
  }
  if (standings.length * q < 2) throw new Error('Il faut au moins 2 qualifiés')
  const mainSeeds =
    config.placement === 'classic' ? classicSeeding(standings, q) : randomSeeding(standings, q, rng)
  const maxSize = Math.max(...standings.map((s) => s.rankedPlayerIds.length))
  const eliminated: string[] = []
  for (let rank = q; rank < maxSize; rank++) {
    for (const s of standings) if (s.rankedPlayerIds[rank]) eliminated.push(s.rankedPlayerIds[rank])
  }
  return buildKnockoutPhase(
    mainSeeds,
    { thirdPlace: config.thirdPlace, consolation: config.consolation ? eliminated : null },
    rng,
  )
}
