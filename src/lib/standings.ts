/**
 * Classements de poule.
 *
 * - Classement d'abord au nombre de victoires.
 * - Joueur remplacé en cours de poule : ses matchs joués restent à son nom (il n'est plus classé),
 *   mais comptent pour ses adversaires ; son remplaçant est classé sur ses propres matchs.
 * - Mini-pong, à égalité de victoires : confrontations directes entre les joueurs à égalité
 *   (appliquées à nouveau dans chaque sous-groupe), puis différence de sets, puis différence de points
 *   (sur tous les matchs de poule).
 * - Fléchettes, à égalité de victoires : partie de départage à plusieurs donnant un classement complet.
 * - Égalité restante (fléchettes toujours ; mini-pong si égalité parfaite) : départage saisi
 *   (partie à plusieurs, ou décision de l'admin) — demandé seulement si l'égalité chevauche la limite
 *   des qualifiés. Sinon les joueurs restent « ex aequo ».
 */
import type { SetScore } from './scores.ts'

export type StandingMatch = {
  home: string
  away: string
  status: 'pending' | 'bye' | 'played' | 'walkover' | 'cancelled'
  winner: string | null
  sets: readonly SetScore[]
}

/** Départage saisi : classement complet d'un groupe de joueurs à égalité. */
export type Tiebreak = { ranking: readonly string[] }

export type StandingRow = {
  playerId: string
  played: number
  wins: number
  losses: number
  setsFor: number
  setsAgainst: number
  pointsFor: number
  pointsAgainst: number
  /** Rang (1 = premier). Des joueurs ex aequo partagent le même rang. */
  rank: number
  /** Départagé par une partie / décision saisie. */
  byTiebreak: boolean
}

export type PoolStandingResult = {
  rows: StandingRow[]
  /** Tous les matchs de la poule ont un résultat (ou sont annulés). */
  complete: boolean
  /** Égalités à départager avant de générer la phase finale (joueurs triés par identifiant). */
  pendingTies: string[][]
}

const DONE = new Set(['played', 'walkover', 'cancelled'])

/** Clé d'un groupe de joueurs (identifiants triés), pour retrouver un départage saisi. */
export function groupKey(playerIds: readonly string[]): string {
  return [...playerIds].sort().join(',')
}

function emptyRow(playerId: string): StandingRow {
  return {
    playerId,
    played: 0,
    wins: 0,
    losses: 0,
    setsFor: 0,
    setsAgainst: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    rank: 0,
    byTiebreak: false,
  }
}

/** Partitionne une liste triée en groupes de valeur égale (ordre décroissant de la valeur). */
function partitionBy<T>(items: readonly T[], value: (item: T) => number): T[][] {
  const sorted = [...items].sort((a, b) => value(b) - value(a))
  const groups: T[][] = []
  for (const item of sorted) {
    const last = groups.at(-1)
    if (last && value(last[0]) === value(item)) last.push(item)
    else groups.push([item])
  }
  return groups
}

export function computePoolStanding(
  playerIds: readonly string[],
  matches: readonly StandingMatch[],
  discipline: 'mini_pong' | 'darts',
  qualifiers: number,
  tiebreaks: ReadonlyMap<string, Tiebreak> = new Map(),
): PoolStandingResult {
  const rows = new Map(playerIds.map((id) => [id, emptyRow(id)]))
  const counted = matches.filter((m) => (m.status === 'played' || m.status === 'walkover') && m.winner)

  // Un match contre un joueur qui n'est plus inscrit (remplacé en cours de poule) compte pour son adversaire.
  const tally = (row: StandingRow | undefined, side: 'home' | 'away', m: StandingMatch) => {
    if (!row) return
    const other = side === 'home' ? 'away' : 'home'
    row.played++
    if (m.winner === m[side]) row.wins++
    else row.losses++
    for (const s of m.sets) {
      row.pointsFor += s[side]
      row.pointsAgainst += s[other]
      if (s[side] > s[other]) row.setsFor++
      else row.setsAgainst++
    }
  }
  for (const m of counted) {
    tally(rows.get(m.home), 'home', m)
    tally(rows.get(m.away), 'away', m)
  }
  const complete = matches.every((m) => DONE.has(m.status))

  /** Victoires d'un joueur contre les autres joueurs du groupe. */
  const headToHeadWins = (playerId: string, group: readonly string[]) =>
    counted.filter(
      (m) =>
        m.winner === playerId &&
        group.includes(m.home) &&
        group.includes(m.away),
    ).length
  const row = (id: string) => rows.get(id) as StandingRow

  /** Groupes successifs (meilleur d'abord) ; un groupe de plus d'un joueur reste à égalité. */
  const separate = (group: string[]): string[][] => {
    if (group.length === 1 || discipline === 'darts') return [group]
    const byH2h = partitionBy(group, (id) => headToHeadWins(id, group))
    if (byH2h.length > 1) return byH2h.flatMap(separate)
    const bySets = partitionBy(group, (id) => row(id).setsFor - row(id).setsAgainst)
    if (bySets.length > 1) return bySets.flatMap(separate)
    const byPoints = partitionBy(group, (id) => row(id).pointsFor - row(id).pointsAgainst)
    if (byPoints.length > 1) return byPoints.flatMap(separate)
    return [group]
  }

  const ordered: StandingRow[] = []
  const pendingTies: string[][] = []
  for (const winGroup of partitionBy([...playerIds], (id) => row(id).wins)) {
    for (const group of separate(winGroup)) {
      const start = ordered.length
      if (group.length === 1) {
        ordered.push({ ...row(group[0]), rank: start + 1 })
        continue
      }
      const tiebreak = tiebreaks.get(groupKey(group))
      if (tiebreak && groupKey(tiebreak.ranking) === groupKey(group)) {
        tiebreak.ranking.forEach((id, i) => ordered.push({ ...row(id), rank: start + i + 1, byTiebreak: true }))
        continue
      }
      // Égalité non départagée : même rang ; à départager si elle chevauche la limite des qualifiés.
      if (complete && start < qualifiers && start + group.length > qualifiers) pendingTies.push([...group].sort())
      for (const id of [...group].sort()) ordered.push({ ...row(id), rank: start + 1 })
    }
  }
  return { rows: ordered, complete, pendingTies }
}

/** Classements prêts pour la phase finale, ou la liste de ce qui manque. */
export function finalStandings(
  pools: readonly { label: string; result: PoolStandingResult }[],
): { ok: true; standings: { label: string; rankedPlayerIds: string[] }[] } | { ok: false; problems: string[] } {
  const problems: string[] = []
  for (const { label, result } of pools) {
    if (!result.complete) problems.push(`Poule ${label} : tous les matchs ne sont pas joués.`)
    else if (result.pendingTies.length) problems.push(`Poule ${label} : égalité à départager.`)
  }
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    standings: pools.map(({ label, result }) => ({ label, rankedPlayerIds: result.rows.map((r) => r.playerId) })),
  }
}
