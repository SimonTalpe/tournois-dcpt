import { coinFlip } from './random.ts'
import type { PlanLink, PlanMatch, PlanRound, Rng, Slot } from './types.ts'

/** Participant d'un tableau : joueur connu, ou perdant d'un match (consolante alimentée en cours de tournoi). */
export type Entrant = { kind: 'player'; playerId: string } | { kind: 'loser'; matchKey: string }

export type BuiltBracket = {
  rounds: PlanRound[]
  matches: PlanMatch[]
  /** Liens « perdant de tel match → ici » à poser sur les matchs d'origine (consolante). */
  feederLinks: { fromMatchKey: string; link: PlanLink }[]
}

/** Plus petite puissance de 2 ≥ n. */
export function nextPowerOfTwo(n: number): number {
  let size = 1
  while (size < n) size *= 2
  return size
}

/**
 * Ordre classique des têtes de série dans un tableau de `size` places (haut → bas).
 * Ex. 8 places : [1, 8, 4, 5, 2, 7, 3, 6] — les têtes 1 et 2 ne peuvent se rencontrer qu'en finale.
 * Les exempts prennent les dernières têtes : ils sont ainsi répartis dans tout le tableau.
 */
export function bracketOrder(size: number): number[] {
  if (size < 1 || nextPowerOfTwo(size) !== size) throw new Error(`Taille de tableau invalide : ${size}`)
  let order = [1]
  while (order.length < size) {
    const total = order.length * 2 + 1
    order = order.flatMap((seed) => [seed, total - seed])
  }
  return order
}

/** Tour au cours duquel deux places du tableau (index 0-based) peuvent se rencontrer (1 = 1er tour). */
export function meetingRound(slotA: number, slotB: number): number {
  return Math.floor(Math.log2(slotA ^ slotB)) + 1
}

/** Nom d'un tour selon son nombre de matchs. */
export function roundName(bracket: 'main' | 'consolation', matchCount: number): string {
  const base =
    matchCount === 1
      ? 'Finale'
      : matchCount === 2
        ? 'Demi-finales'
        : matchCount === 4
          ? 'Quarts de finale'
          : `${matchCount}es de finale`
  return bracket === 'main' ? base : `Consolante — ${base.charAt(0).toLowerCase()}${base.slice(1)}`
}

export function matchKey(bracket: string, round: number, position: number): string {
  return `${bracket}-${round}-${position}`
}

const other = (slot: Slot): Slot => (slot === 'home' ? 'away' : 'home')

/**
 * Tableau à élimination directe.
 * - `entrants` : dans l'ordre des têtes de série (1re = tête n°1). Pour un tirage au sort, mélanger avant.
 * - Taille = puissance de 2 supérieure ; les places manquantes sont des exempts (match « bye »).
 * - Domicile / extérieur tirés au sort pour chaque match (y compris l'arrivée dans les tours suivants).
 * - Exempt d'un joueur connu : il est directement placé au tour suivant.
 *   Exempt d'un perdant à venir (consolante) : le lien pointe vers le match « bye », qui le qualifiera
 *   automatiquement à son arrivée (étape 4).
 */
export function buildBracket(
  entrants: readonly Entrant[],
  bracket: 'main' | 'consolation',
  rng: Rng,
): BuiltBracket {
  const n = entrants.length
  if (n < 2) throw new Error('Il faut au moins 2 participants pour un tableau')
  const size = nextPowerOfTwo(n)
  const roundCount = Math.log2(size)

  const rounds: PlanRound[] = []
  const byRound: PlanMatch[][] = []
  for (let r = 1; r <= roundCount; r++) {
    const count = size / 2 ** r
    rounds.push({ key: `${bracket}-${r}`, bracket, roundNumber: r, name: roundName(bracket, count) })
    byRound.push(
      Array.from({ length: count }, (_, i) => ({
        key: matchKey(bracket, r, i + 1),
        roundKey: `${bracket}-${r}`,
        poolLabel: null,
        position: i + 1,
        home: null,
        away: null,
        status: 'pending' as const,
        winner: null,
        next: null,
        loserNext: null,
      })),
    )
  }

  // Liens vainqueur → tour suivant (côté domicile/extérieur tiré au sort pour chaque paire).
  for (let r = 0; r < roundCount - 1; r++) {
    const current = byRound[r]
    for (let i = 0; i < current.length; i += 2) {
      const target = byRound[r + 1][i / 2].key
      const firstSlot: Slot = coinFlip(rng) ? 'home' : 'away'
      current[i].next = { matchKey: target, slot: firstSlot }
      current[i + 1].next = { matchKey: target, slot: other(firstSlot) }
    }
  }

  const matchesByKey = new Map(byRound.flat().map((m) => [m.key, m]))
  const feederLinks: BuiltBracket['feederLinks'] = []
  const place = (match: PlanMatch, slot: Slot, entrant: Entrant) => {
    if (entrant.kind === 'player') match[slot] = entrant.playerId
    else feederLinks.push({ fromMatchKey: entrant.matchKey, link: { matchKey: match.key, slot } })
  }

  const order = bracketOrder(size)
  byRound[0].forEach((match, i) => {
    const a = order[2 * i] <= n ? entrants[order[2 * i] - 1] : null
    const b = order[2 * i + 1] <= n ? entrants[order[2 * i + 1] - 1] : null
    if (a && b) {
      const [home, away] = coinFlip(rng) ? [a, b] : [b, a]
      place(match, 'home', home)
      place(match, 'away', away)
      return
    }
    const alone = (a ?? b) as Entrant
    match.status = 'bye'
    place(match, 'home', alone)
    if (alone.kind === 'player') {
      match.winner = alone.playerId
      if (match.next) {
        const nextMatch = matchesByKey.get(match.next.matchKey) as PlanMatch
        nextMatch[match.next.slot] = alone.playerId
      }
    }
  })

  return { rounds, matches: byRound.flat(), feederLinks }
}
