import type { BracketKind } from '../../lib/draw/types.ts'
import type { Match, Round } from './types.ts'

const BRACKET_ORDER: Record<BracketKind, number> = { pool: 0, main: 1, third_place: 2, consolation: 3 }

/** Tours triés : poules, tableau principal, 3e place, consolante. */
export function sortRounds(rounds: readonly Round[]): Round[] {
  return [...rounds].sort(
    (a, b) => BRACKET_ORDER[a.bracket] - BRACKET_ORDER[b.bracket] || a.round_number - b.round_number,
  )
}

/**
 * Numéros des matchs de tableau (« M1 », « M2 »…), dans l'ordre de lecture :
 * tableau principal tour par tour, puis 3e place, puis consolante. Les poules ne sont pas numérotées.
 */
export function numberMatches(rounds: readonly Round[], matches: readonly Match[]): Map<string, number> {
  const numbers = new Map<string, number>()
  let next = 1
  for (const round of sortRounds(rounds)) {
    if (round.bracket === 'pool') continue
    const inRound = matches.filter((m) => m.round_id === round.id).sort((a, b) => a.position - b.position)
    for (const match of inRound) numbers.set(match.id, next++)
  }
  return numbers
}

export type SlotSource = { kind: 'winner' | 'loser'; matchId: string }

/** D'où vient le joueur attendu à chaque place (vainqueur / perdant de tel match). */
export function slotSources(matches: readonly Match[]): Map<string, SlotSource> {
  const sources = new Map<string, SlotSource>()
  for (const m of matches) {
    if (m.next_match_id && m.next_slot) sources.set(`${m.next_match_id}:${m.next_slot}`, { kind: 'winner', matchId: m.id })
    if (m.loser_next_match_id && m.loser_next_slot)
      sources.set(`${m.loser_next_match_id}:${m.loser_next_slot}`, { kind: 'loser', matchId: m.id })
  }
  return sources
}

/** Texte d'attente pour une place encore vide : « Vainqueur M3 », « Perdant M12 ». */
export function placeholderLabel(source: SlotSource | undefined, numbers: Map<string, number>): string {
  if (!source) return 'À déterminer'
  const n = numbers.get(source.matchId)
  const ref = n ? `M${n}` : 'match précédent'
  return source.kind === 'winner' ? `Vainqueur ${ref}` : `Perdant ${ref}`
}
