/**
 * Phase de qualification (format « Qualification puis élimination directe », décision du 24/11/2026).
 *
 * - V victoires pour se qualifier, D défaites pour être éliminé ; un exempt compte comme une victoire
 *   sans points, un forfait comme une victoire (ou défaite) sans points.
 * - Classement des qualifiés : moins de défaites d'abord (les repêchés derrière les gagnants du
 *   round 1), puis différence de points, puis points marqués, puis tirage au sort.
 *   Mini-pong : points des sets ; fléchettes : manches.
 * - Le tirage au sort des égalités est stable : une clé tirée de l'identifiant du tournoi et du joueur
 *   (même résultat à chaque affichage, impossible à choisir).
 * - Les matchs eux-mêmes sont créés par la base (qualification_progress) ; ce module ne fait que lire.
 */
import type { SetScore } from './scores.ts'

export type QualificationMatch = {
  home: string | null
  away: string | null
  status: 'pending' | 'bye' | 'played' | 'walkover' | 'cancelled'
  winner: string | null
  /** Mini-pong : sets joués. */
  sets: readonly SetScore[]
  /** Fléchettes : manches gagnées (match joué). */
  legs?: { home: number; away: number } | null
}

export type QualificationStatus = 'qualified' | 'eliminated' | 'playing' | 'waiting'

export type QualificationRow = {
  playerId: string
  wins: number
  losses: number
  /** Matchs joués (exempts exclus, forfaits compris). */
  played: number
  byes: number
  pointsFor: number
  pointsAgainst: number
  status: QualificationStatus
  /** Rang parmi les qualifiés (1 = meilleur), null sinon. */
  seed: number | null
  /** Rang départagé au tirage au sort (égalité parfaite avec un voisin). */
  tiedByDraw: boolean
}

export type QualificationStandings = {
  /** Qualifiés classés, puis joueurs en lice, puis éliminés. */
  rows: QualificationRow[]
  /** Tous les joueurs sont qualifiés ou éliminés. */
  complete: boolean
  /** Qualifiés dans l'ordre du classement (têtes de série du tableau final). */
  qualified: string[]
}

/** Clé de tirage au sort stable (FNV-1a 32 bits). */
export function drawKey(tournamentId: string, playerId: string): number {
  let hash = 0x811c9dc5
  for (const char of `${tournamentId}:${playerId}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function emptyRow(playerId: string): QualificationRow {
  return {
    playerId,
    wins: 0,
    losses: 0,
    played: 0,
    byes: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    status: 'waiting',
    seed: null,
    tiedByDraw: false,
  }
}

export function computeQualification(input: {
  tournamentId: string
  playerIds: readonly string[]
  matches: readonly QualificationMatch[]
  wins: number
  losses: number
}): QualificationStandings {
  const rows = new Map(input.playerIds.map((id) => [id, emptyRow(id)]))
  const busy = new Set<string>()
  for (const m of input.matches) {
    if (m.status === 'bye') {
      const row = m.winner ? rows.get(m.winner) : undefined
      if (row) {
        row.wins++
        row.byes++
      }
      continue
    }
    if (m.status === 'pending') {
      for (const id of [m.home, m.away]) if (id) busy.add(id)
      continue
    }
    if ((m.status !== 'played' && m.status !== 'walkover') || !m.home || !m.away) continue
    const [homeFor, awayFor] =
      m.status === 'played'
        ? m.legs
          ? [m.legs.home, m.legs.away]
          : [m.sets.reduce((n, s) => n + s.home, 0), m.sets.reduce((n, s) => n + s.away, 0)]
        : [0, 0]
    for (const [id, own, other] of [
      [m.home, homeFor, awayFor],
      [m.away, awayFor, homeFor],
    ] as const) {
      const row = rows.get(id)
      if (!row) continue
      row.played++
      row.pointsFor += own
      row.pointsAgainst += other
      if (m.winner === id) row.wins++
      else row.losses++
    }
  }

  for (const row of rows.values()) {
    row.status =
      row.wins >= input.wins
        ? 'qualified'
        : row.losses >= input.losses
          ? 'eliminated'
          : busy.has(row.playerId)
            ? 'playing'
            : 'waiting'
  }

  const diff = (r: QualificationRow) => r.pointsFor - r.pointsAgainst
  const key = (r: QualificationRow) => drawKey(input.tournamentId, r.playerId)
  const merit = (a: QualificationRow, b: QualificationRow) =>
    a.losses - b.losses || diff(b) - diff(a) || b.pointsFor - a.pointsFor
  const all = [...rows.values()]
  const qualified = all.filter((r) => r.status === 'qualified').sort((a, b) => merit(a, b) || key(a) - key(b))
  qualified.forEach((row, i) => {
    row.seed = i + 1
    const tied = (other: QualificationRow | undefined) => other !== undefined && merit(row, other) === 0
    row.tiedByDraw = tied(qualified[i - 1]) || tied(qualified[i + 1])
  })
  const progress = (a: QualificationRow, b: QualificationRow) =>
    b.wins - a.wins || a.losses - b.losses || diff(b) - diff(a) || b.pointsFor - a.pointsFor || key(a) - key(b)
  const active = all.filter((r) => r.status === 'playing' || r.status === 'waiting').sort(progress)
  const eliminated = all.filter((r) => r.status === 'eliminated').sort(progress)

  return {
    rows: [...qualified, ...active, ...eliminated],
    complete: active.length === 0,
    qualified: qualified.map((r) => r.playerId),
  }
}

/**
 * Nombre de qualifiés à la fin de la phase, connu dès le lancement : chaque bilan de n joueurs
 * donne ⌈n/2⌉ gagnants (exempt compris) et ⌊n/2⌋ perdants, quel que soit l'ordre des matchs.
 */
export function expectedQualifierCount(playerCount: number, wins: number, losses: number): number {
  const buckets = new Map<string, number>([['0-0', playerCount]])
  let qualified = 0
  for (let played = 0; played < wins + losses - 1; played++) {
    for (let w = Math.min(played, wins - 1); w >= 0; w--) {
      const l = played - w
      if (l >= losses) continue
      const n = buckets.get(`${w}-${l}`) ?? 0
      if (!n) continue
      const winners = Math.ceil(n / 2)
      const losers = Math.floor(n / 2)
      if (w + 1 >= wins) qualified += winners
      else buckets.set(`${w + 1}-${l}`, (buckets.get(`${w + 1}-${l}`) ?? 0) + winners)
      if (l + 1 < losses) buckets.set(`${w}-${l + 1}`, (buckets.get(`${w}-${l + 1}`) ?? 0) + losers)
    }
  }
  return qualified
}

/** Exemptés du tour préliminaire : places libres du tableau (puissance de 2 supérieure). */
export function preliminaryByeCount(qualifierCount: number): number {
  let size = 1
  while (size < qualifierCount) size *= 2
  return size === qualifierCount ? 0 : size - qualifierCount
}
