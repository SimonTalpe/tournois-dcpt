/**
 * Règles de saisie des scores (identiques à celles appliquées par la base :
 * fonctions mini_pong_winner et check_result_rights). Ici pour des messages précis avant envoi.
 */

export type SetScore = { home: number; away: number }
export type Side = 'home' | 'away'

export const POINTS_TO_WIN_SET = 11
export const CORRECTION_WINDOW_MS = 5 * 60 * 1000

/** Nombre maximal de sets d'un match en `setsToWin` sets gagnants (ex. 2 → 3 sets). */
export function maxSets(setsToWin: number): number {
  return setsToWin * 2 - 1
}

/** Erreur d'un set (11 points, 2 points d'écart ; au-delà de 11, écart de 2 exactement), ou null. */
export function checkSet({ home, away }: SetScore): string | null {
  if (![home, away].every((p) => Number.isInteger(p) && p >= 0 && p <= 99)) return 'les points vont de 0 à 99'
  const high = Math.max(home, away)
  const gap = Math.abs(home - away)
  if (high < POINTS_TO_WIN_SET) return 'le vainqueur du set doit marquer au moins 11 points'
  if (gap < 2) return 'il faut 2 points d’écart'
  if (high > POINTS_TO_WIN_SET && gap !== 2) return 'au-delà de 11 points, le set se termine avec 2 points d’écart exactement'
  return null
}

export type ScoreCheck = { ok: true; winner: Side } | { ok: false; error: string }

/** Vérifie un match de mini-pong complet et renvoie le vainqueur. */
export function checkMiniPongSets(sets: readonly SetScore[], setsToWin: number): ScoreCheck {
  if (sets.length === 0) return { ok: false, error: 'Saisis le score d’au moins un set.' }
  let home = 0
  let away = 0
  for (const [index, set] of sets.entries()) {
    if (home === setsToWin || away === setsToWin) {
      return { ok: false, error: `Set ${index + 1} en trop : le match est déjà gagné.` }
    }
    const error = checkSet(set)
    if (error) return { ok: false, error: `Set ${index + 1} (${set.home}-${set.away}) : ${error}.` }
    if (set.home > set.away) home++
    else away++
  }
  if (home === setsToWin) return { ok: true, winner: 'home' }
  if (away === setsToWin) return { ok: true, winner: 'away' }
  return {
    ok: false,
    error: `Match inachevé : il faut ${setsToWin} set${setsToWin > 1 ? 's' : ''} gagnant${setsToWin > 1 ? 's' : ''} (${home}-${away}).`,
  }
}

/** Sets gagnés par chaque joueur. */
export function setsWon(sets: readonly SetScore[]): Record<Side, number> {
  return sets.reduce(
    (acc, s) => (s.home > s.away ? { ...acc, home: acc.home + 1 } : { ...acc, away: acc.away + 1 }),
    { home: 0, away: 0 },
  )
}

/**
 * Lignes du formulaire (texte saisi) → sets. Les lignes entièrement vides sont ignorées ;
 * une ligne à moitié remplie est une erreur.
 */
export function parseSetRows(rows: readonly { home: string; away: string }[]): { sets: SetScore[] } | { error: string } {
  const sets: SetScore[] = []
  for (const [index, row] of rows.entries()) {
    const home = row.home.trim()
    const away = row.away.trim()
    if (!home && !away) continue
    if (!/^\d{1,2}$/.test(home) || !/^\d{1,2}$/.test(away)) {
      return { error: `Set ${index + 1} : indique les points des deux joueurs (nombres).` }
    }
    sets.push({ home: Number(home), away: Number(away) })
  }
  return { sets }
}

export type ResultContext = {
  status: 'pending' | 'bye' | 'played' | 'walkover' | 'cancelled'
  homePlayerId: string | null
  awayPlayerId: string | null
  resultBy: string | null
  resultByAdmin: boolean
  resultFirstAt: string | null
}

export type ResultRights =
  | { canEdit: true; deadline: Date | null }
  | { canEdit: false; reason: string | null }

/**
 * Qui peut saisir / corriger un résultat (affichage ; la base applique les mêmes règles).
 * `reason` est null quand il n'y a rien à expliquer (spectateur, joueur hors du match).
 */
export function resultRights(
  match: ResultContext,
  viewer: { isAdmin: boolean; isActivePlayer: boolean; profileId: string | null; playerId: string | null },
  tournamentStatus: 'draft' | 'in_progress' | 'finished' | 'archived',
  now: Date = new Date(),
): ResultRights {
  const inMatch = Boolean(viewer.playerId && [match.homePlayerId, match.awayPlayerId].includes(viewer.playerId))
  if (!viewer.isAdmin && !(viewer.isActivePlayer && inMatch)) return { canEdit: false, reason: null }
  if (!(tournamentStatus === 'in_progress' || (viewer.isAdmin && tournamentStatus === 'finished'))) {
    return { canEdit: false, reason: 'Le tournoi n’est pas en cours.' }
  }
  if (!['pending', 'played'].includes(match.status) || !match.homePlayerId || !match.awayPlayerId) {
    return { canEdit: false, reason: 'Les deux joueurs du match ne sont pas encore connus.' }
  }
  if (match.status === 'pending' || viewer.isAdmin) return { canEdit: true, deadline: null }
  if (match.resultByAdmin) return { canEdit: false, reason: 'Résultat saisi par l’admin : seul l’admin peut le modifier.' }
  if (match.resultBy !== viewer.profileId) {
    return { canEdit: false, reason: 'Résultat saisi par ton adversaire : contacte l’admin en cas d’erreur.' }
  }
  const deadline = new Date(new Date(match.resultFirstAt ?? 0).getTime() + CORRECTION_WINDOW_MS)
  if (now > deadline) return { canEdit: false, reason: 'Délai de correction (5 minutes) dépassé : contacte l’admin.' }
  return { canEdit: true, deadline }
}
