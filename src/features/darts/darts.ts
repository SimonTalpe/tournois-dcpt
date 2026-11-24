/**
 * Fléchettes : une fléchette, sa valeur, son libellé, et les finishs conseillés.
 * Segment 0 = fléchette ratée, 1 à 20, 25 = centre (simple 25, double = « Bull » 50).
 */

export type Multiplier = 1 | 2 | 3
export type Dart = { segment: number; multiplier: Multiplier }

export const MISS: Dart = { segment: 0, multiplier: 1 }

export function isValidDart(dart: Dart): boolean {
  const { segment, multiplier } = dart
  if (![1, 2, 3].includes(multiplier)) return false
  if (segment === 0) return multiplier === 1
  if (segment === 25) return multiplier !== 3
  return Number.isInteger(segment) && segment >= 1 && segment <= 20
}

export function dartValue(dart: Dart): number {
  return dart.segment * dart.multiplier
}

/** Une fléchette qui termine une partie « sortie sur double » (doubles et Bull). */
export function isDouble(dart: Dart): boolean {
  return dart.multiplier === 2 && dart.segment > 0
}

/** Libellé court : « T20 », « D16 », « 5 », « 25 », « Bull », « 0 ». */
export function dartLabel(dart: Dart): string {
  if (dart.segment === 0) return '0'
  if (dart.segment === 25) return dart.multiplier === 2 ? 'Bull' : '25'
  if (dart.multiplier === 3) return `T${dart.segment}`
  if (dart.multiplier === 2) return `D${dart.segment}`
  return String(dart.segment)
}

/** « 1er », « 2e »… */
export function placeLabel(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`
}

/** Rang affiché dans les classements de partie (chiffre seul, le design n'utilise pas d'émojis). */
export function medal(rank: number): string {
  return String(rank)
}

// ---------------------------------------------------------------- Finishs

const SCORING_DARTS: Dart[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 3 as const })),
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 2 as const })),
  ...Array.from({ length: 20 }, (_, i) => ({ segment: i + 1, multiplier: 1 as const })),
  { segment: 25, multiplier: 1 },
  { segment: 25, multiplier: 2 },
]

/** Difficulté d'une fléchette : un simple est plus facile à toucher qu'un double ou un triple. */
function difficulty(dart: Dart): number {
  if (dart.segment === 25) return dart.multiplier === 2 ? 4 : 2
  return dart.multiplier === 1 ? 1 : 3
}

/** Doubles de sortie préférés des joueurs (les plus « confortables » d'abord). */
const PREFERRED_DOUBLES = [20, 16, 10, 8, 18, 12, 4, 2, 6, 14, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 25]

function finishPreference(dart: Dart, doubleOut: boolean): number {
  if (!doubleOut) return 0
  return PREFERRED_DOUBLES.indexOf(dart.segment)
}

type Candidate = { darts: Dart[]; key: number[] }

function candidateKey(darts: Dart[], doubleOut: boolean): number[] {
  const last = darts[darts.length - 1]
  return [
    darts.length,
    darts.reduce((sum, d) => sum + difficulty(d), 0),
    finishPreference(last, doubleOut),
    // À égalité, on vise d'abord le plus gros (T20 avant T19…).
    -dartValue(darts[0]),
  ]
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

const cache = new Map<string, Dart[] | null>()

/**
 * Finish le plus simple pour terminer `remaining` points avec au plus `dartsLeft` fléchettes :
 * le moins de fléchettes possible, puis les cibles les plus faciles, puis les doubles préférés.
 * Renvoie null si aucun finish n'est possible.
 */
export function suggestCheckout(remaining: number, dartsLeft: number, doubleOut: boolean): Dart[] | null {
  if (remaining <= 0 || dartsLeft <= 0) return null
  if (remaining > dartsLeft * 60) return null
  const cacheKey = `${remaining}|${dartsLeft}|${doubleOut}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  const finals = doubleOut ? SCORING_DARTS.filter(isDouble) : SCORING_DARTS
  const finalsByValue = new Map<number, Dart[]>()
  for (const f of finals) {
    const list = finalsByValue.get(dartValue(f)) ?? []
    list.push(f)
    finalsByValue.set(dartValue(f), list)
  }

  let best: Candidate | null = null
  const consider = (darts: Dart[]) => {
    const key = candidateKey(darts, doubleOut)
    if (!best || better(key, best.key)) best = { darts, key }
  }

  for (let count = 1; count <= Math.min(3, dartsLeft) && !best; count++) {
    if (count === 1) {
      for (const f of finalsByValue.get(remaining) ?? []) consider([f])
    } else if (count === 2) {
      for (const a of SCORING_DARTS) {
        for (const f of finalsByValue.get(remaining - dartValue(a)) ?? []) consider([a, f])
      }
    } else {
      for (let i = 0; i < SCORING_DARTS.length; i++) {
        for (let j = i; j < SCORING_DARTS.length; j++) {
          const [a, b] = [SCORING_DARTS[i], SCORING_DARTS[j]]
          const first = dartValue(a) >= dartValue(b) ? [a, b] : [b, a]
          for (const f of finalsByValue.get(remaining - dartValue(a) - dartValue(b)) ?? []) consider([...first, f])
        }
      }
    }
  }

  const result = (best as Candidate | null)?.darts ?? null
  cache.set(cacheKey, result)
  return result
}
