import { toParisParts } from '../../lib/schedule.ts'
import { setsWon } from '../../lib/scores.ts'
import { dartLegsScore, numberMatches, placeholderLabel, slotSources } from '../tournaments/display.ts'
import type { Match, Tournament, TournamentBundle } from '../tournaments/types.ts'

/**
 * Page d'accueil : calculs à partir des tournois chargés (fonctions pures, testées).
 */

/** Participant lié au compte dans un tournoi. */
export function myPlayerId(bundle: TournamentBundle, profileId: string | null): string | null {
  if (!profileId) return null
  for (const p of bundle.players.values()) if (p.profile_id === profileId) return p.id
  return null
}

/** « Poule A » ou « Demi-finales · M5 ». */
function roundLabel(bundle: TournamentBundle, match: Match, numbers: Map<string, number>): string {
  if (match.pool_id) return `Poule ${bundle.pools.find((p) => p.id === match.pool_id)?.label ?? ''}`.trim()
  const round = bundle.rounds.find((r) => r.id === match.round_id)
  const n = numbers.get(match.id)
  return [round?.name, n ? `M${n}` : null].filter(Boolean).join(' · ')
}

export type MyMatch = {
  match: Match
  tournament: Tournament
  roundLabel: string
  /** Nom de l'adversaire, ou attente (« Vainqueur M3 »). */
  opponent: string
  opponentKnown: boolean
  locationName: string | null
}

/**
 * Prochains matchs du joueur dans les tournois en cours, tous tournois confondus :
 * d'abord ceux qui ont un horaire (du plus proche au plus lointain), puis ceux dont l'adversaire est connu,
 * puis ceux qui attendent un adversaire.
 */
export function myUpcomingMatches(bundles: readonly TournamentBundle[], profileId: string | null): MyMatch[] {
  const result: MyMatch[] = []
  for (const bundle of bundles) {
    if (bundle.tournament.status !== 'in_progress') continue
    const me = myPlayerId(bundle, profileId)
    if (!me) continue
    const numbers = numberMatches(bundle.rounds, bundle.matches)
    const sources = slotSources(bundle.matches)
    const locations = new Map(bundle.locations.map((l) => [l.id, l.name]))
    for (const match of bundle.matches) {
      if (match.status !== 'pending') continue
      const side = match.home_player_id === me ? 'home' : match.away_player_id === me ? 'away' : null
      if (!side) continue
      const otherSide = side === 'home' ? 'away' : 'home'
      const otherId = side === 'home' ? match.away_player_id : match.home_player_id
      result.push({
        match,
        tournament: bundle.tournament,
        roundLabel: roundLabel(bundle, match, numbers),
        opponent: otherId
          ? (bundle.players.get(otherId)?.full_name ?? 'Joueur inconnu')
          : placeholderLabel(sources.get(`${match.id}:${otherSide}`), numbers),
        opponentKnown: Boolean(otherId),
        locationName: match.location_id ? (locations.get(match.location_id) ?? null) : null,
      })
    }
  }
  const rank = (m: MyMatch) => (m.match.scheduled_at ? 0 : m.opponentKnown ? 1 : 2)
  return result.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.match.scheduled_at ?? '').localeCompare(b.match.scheduled_at ?? '') ||
      a.tournament.name.localeCompare(b.tournament.name, 'fr') ||
      a.match.position - b.match.position,
  )
}

/** Tournois en cours où le joueur est inscrit. */
export function myTournamentsInProgress(bundles: readonly TournamentBundle[], profileId: string | null): Tournament[] {
  return bundles
    .filter((b) => b.tournament.status === 'in_progress')
    .filter((b) => {
      const me = myPlayerId(b, profileId)
      return me !== null && b.entries.some((e) => e.player_id === me)
    })
    .map((b) => b.tournament)
}

export type RecentResult = {
  match: Match
  tournament: Tournament
  roundLabel: string
  home: string
  away: string
  /** Score en sets (mini-pong), sinon null. */
  score: { home: number; away: number } | null
  forfeitName: string | null
}

/** Derniers résultats (scores et forfaits), du plus récent au plus ancien. */
export function recentResults(bundles: readonly TournamentBundle[], limit = 5): RecentResult[] {
  const all: RecentResult[] = []
  for (const bundle of bundles) {
    const numbers = numberMatches(bundle.rounds, bundle.matches)
    const name = (id: string | null) => (id ? (bundle.players.get(id)?.full_name ?? 'Joueur inconnu') : '—')
    for (const match of bundle.matches) {
      if ((match.status !== 'played' && match.status !== 'walkover') || !match.result_at) continue
      const sets = bundle.sets.get(match.id)
      all.push({
        match,
        tournament: bundle.tournament,
        roundLabel: roundLabel(bundle, match, numbers),
        home: name(match.home_player_id),
        away: name(match.away_player_id),
        score: match.status === 'played' && sets?.length ? setsWon(sets) : dartLegsScore(match),
        forfeitName: match.status === 'walkover' ? name(match.forfeit_player_id) : null,
      })
    }
  }
  return all.sort((a, b) => (b.match.result_at ?? '').localeCompare(a.match.result_at ?? '')).slice(0, limit)
}

/** Avancement d'un tournoi : matchs joués (score, forfait, annulé) sur matchs à jouer (hors exempts). */
export function progress(bundle: TournamentBundle): { done: number; total: number } {
  const real = bundle.matches.filter((m) => m.status !== 'bye')
  return { done: real.filter((m) => m.status !== 'pending').length, total: real.length }
}

export type ProgramItem = {
  match: Match
  tournament: Tournament
  /** Heure de Paris, « 12:45 ». */
  time: string
  roundLabel: string
  home: string
  away: string
  locationName: string | null
  /** Le joueur connecté joue ce match. */
  isMine: boolean
  /** Score en sets (mini-pong) ou en manches (fléchettes) d'un match joué, sinon null. */
  score: { home: number; away: number } | null
}

/**
 * Programme d'une journée (date de Paris « 2026-11-23 ») : matchs programmés ce jour-là dans les tournois
 * chargés, quel que soit leur état (sauf exempts et annulés), triés par heure.
 */
export function daySchedule(
  bundles: readonly TournamentBundle[],
  profileId: string | null,
  day: string,
): ProgramItem[] {
  const items: ProgramItem[] = []
  for (const bundle of bundles) {
    const me = myPlayerId(bundle, profileId)
    const numbers = numberMatches(bundle.rounds, bundle.matches)
    const sources = slotSources(bundle.matches)
    const locations = new Map(bundle.locations.map((l) => [l.id, l.name]))
    const name = (match: Match, side: 'home' | 'away') => {
      const id = side === 'home' ? match.home_player_id : match.away_player_id
      return id
        ? (bundle.players.get(id)?.full_name ?? 'Joueur inconnu')
        : placeholderLabel(sources.get(`${match.id}:${side}`), numbers)
    }
    for (const match of bundle.matches) {
      if (!match.scheduled_at || match.status === 'bye' || match.status === 'cancelled') continue
      const parts = toParisParts(match.scheduled_at)
      if (parts.date !== day) continue
      const sets = bundle.sets.get(match.id)
      items.push({
        match,
        tournament: bundle.tournament,
        time: parts.time,
        roundLabel: roundLabel(bundle, match, numbers),
        home: name(match, 'home'),
        away: name(match, 'away'),
        locationName: match.location_id ? (locations.get(match.location_id) ?? null) : null,
        isMine: me !== null && (match.home_player_id === me || match.away_player_id === me),
        score: match.status === 'played' ? (sets?.length ? setsWon(sets) : dartLegsScore(match)) : null,
      })
    }
  }
  return items.sort(
    (a, b) =>
      a.time.localeCompare(b.time) ||
      a.tournament.name.localeCompare(b.tournament.name, 'fr') ||
      a.match.position - b.match.position,
  )
}

/**
 * Jour à afficher dans « Programme de la pause » : aujourd'hui s'il y a des matchs programmés,
 * sinon le prochain jour qui a un match à jouer programmé, sinon null.
 */
export function programDay(bundles: readonly TournamentBundle[], today: string): string | null {
  let next: string | null = null
  for (const bundle of bundles) {
    for (const match of bundle.matches) {
      if (!match.scheduled_at || match.status === 'bye' || match.status === 'cancelled') continue
      const day = toParisParts(match.scheduled_at).date
      if (day === today) return today
      if (day > today && match.status === 'pending' && (next === null || day < next)) next = day
    }
  }
  return next
}

/** Matchs à jouer dont les deux joueurs sont connus mais sans horaire (bloc « À régler » de l'admin). */
export function unscheduledMatches(bundles: readonly TournamentBundle[]): number {
  let count = 0
  for (const bundle of bundles) {
    if (bundle.tournament.status !== 'in_progress') continue
    for (const m of bundle.matches)
      if (m.status === 'pending' && m.home_player_id && m.away_player_id && !m.scheduled_at) count++
  }
  return count
}

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long' })
const dayMonthFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })

/** Titre de date de l'accueil : « 2026-11-23 » → { weekday: 'Lundi', dayMonth: '23 novembre' }. */
export function dayTitle(day: string): { weekday: string; dayMonth: string } {
  const date = new Date(`${day}T12:00:00Z`)
  const weekday = weekdayFormat.format(date)
  return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), dayMonth: dayMonthFormat.format(date) }
}

/** Heure à la française : « 12:45 » → « 12 h 45 ». */
export function frenchTime(time: string): string {
  const [h, m] = time.split(':')
  return `${Number(h)} h ${m}`
}

/**
 * Libellé court d'un horaire relatif à aujourd'hui : « Aujourd'hui, 12 h 45 », « Demain, 13 h 00 »,
 * « Jeudi, 13 h 15 » (dans les 6 jours), sinon « Jeudi 3 décembre, 13 h 15 ».
 */
export function relativeSchedule(iso: string, today: string): string {
  const { date, time } = toParisParts(iso)
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  const { weekday, dayMonth } = dayTitle(date)
  const when = days === 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : days > 1 && days < 7 ? weekday : `${weekday} ${dayMonth}`
  return `${when}, ${frenchTime(time)}`
}
