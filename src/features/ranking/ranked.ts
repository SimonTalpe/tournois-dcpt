/**
 * Règles des matchs classés côté site (identiques à celles de la base : record_ranked_match,
 * check_ranked_rights). Ici pour des messages précis avant envoi. Fonctions pures, testées.
 */
import { checkSet } from '../../lib/scores.ts'
import type { Discipline } from '../tournaments/types.ts'
import type { RankedScore } from './api.ts'

export const RANKED_CORRECTION_WINDOW_MS = 24 * 3600 * 1000
export const RANKED_DAILY_LIMIT = 3

export const RANKED_FORMAT_LABELS: Record<Discipline, string> = {
  mini_pong: '1 set de 11 points',
  darts: '1 manche · 301 · sortie simple',
}

export type RankedViewer = { isAdmin: boolean; profileId: string | null }

export type RankedRights = { canEdit: boolean; reason: string | null }

/** Correction / suppression : l'auteur pendant 24 h (sauf saisie de l'admin pour d'autres), puis l'admin. */
export function rankedRights(
  match: { created_by: string; created_by_admin: boolean; played_at: string },
  viewer: RankedViewer,
  now: Date = new Date(),
): RankedRights {
  if (viewer.isAdmin) return { canEdit: true, reason: null }
  if (!viewer.profileId) return { canEdit: false, reason: null }
  if (match.created_by !== viewer.profileId || match.created_by_admin) {
    return { canEdit: false, reason: 'Saisi par un autre : pour une correction, contacte l’admin.' }
  }
  if (now.getTime() > new Date(match.played_at).getTime() + RANKED_CORRECTION_WINDOW_MS) {
    return { canEdit: false, reason: 'Délai de correction de 24 heures dépassé : contacte l’admin.' }
  }
  return { canEdit: true, reason: null }
}

export type ScoreForm =
  | { discipline: 'mini_pong'; home: string; away: string }
  | { discipline: 'darts'; winner: 'home' | 'away' | null; loserRemaining: string }

/** Vérifie la saisie et renvoie le score au format de la base, ou un message d'erreur. */
export function parseRankedScore(form: ScoreForm): { score: RankedScore; winner: 'home' | 'away' } | { error: string } {
  if (form.discipline === 'mini_pong') {
    if (form.home.trim() === '' || form.away.trim() === '') return { error: 'Saisis le score du set.' }
    const home = Number(form.home)
    const away = Number(form.away)
    const problem = checkSet({ home, away })
    if (problem) return { error: `Score ${form.home}-${form.away} : ${problem}.` }
    return { score: { home, away }, winner: home > away ? 'home' : 'away' }
  }
  if (!form.winner) return { error: 'Choisis le vainqueur.' }
  const text = form.loserRemaining.trim()
  if (text === '') return { score: { winner: form.winner, loser_remaining: null }, winner: form.winner }
  const remaining = Number(text)
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 301) {
    return { error: 'Le reste du perdant va de 1 à 301 (laisse vide si tu ne le connais pas).' }
  }
  return { score: { winner: form.winner, loser_remaining: remaining }, winner: form.winner }
}

/** Score affiché d'un match classé, du point de vue du joueur à domicile (ou d'un joueur donné). */
export function rankedScoreLabel(
  match: {
    discipline: Discipline
    home_player_id: string
    winner_player_id: string
    home_points: number | null
    away_points: number | null
    loser_remaining: number | null
  },
  viewpointPlayerId?: string,
): string | null {
  if (match.discipline === 'mini_pong') {
    if (match.home_points === null || match.away_points === null) return null
    const fromHome = !viewpointPlayerId || viewpointPlayerId === match.home_player_id
    return fromHome ? `${match.home_points} – ${match.away_points}` : `${match.away_points} – ${match.home_points}`
  }
  return match.loser_remaining === null ? null : `reste ${match.loser_remaining}`
}
