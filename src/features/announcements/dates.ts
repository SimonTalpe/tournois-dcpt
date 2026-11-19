import { parisToIso, TIME_ZONE, toParisParts } from '../../lib/schedule.ts'

/**
 * Dates des annonces, saisies en heure de Paris.
 * - Publication : date + heure (programmation possible).
 * - Expiration : un jour, inclus (« visible jusqu'au 5 déc. ») → enregistrée comme le lendemain à 0 h.
 */

export type AnnouncementTiming = { published_at: string; expires_at: string | null }
export type AnnouncementState = 'scheduled' | 'live' | 'expired'

export function announcementState(a: AnnouncementTiming, now: Date = new Date()): AnnouncementState {
  if (Date.parse(a.published_at) > now.getTime()) return 'scheduled'
  if (a.expires_at && Date.parse(a.expires_at) <= now.getTime()) return 'expired'
  return 'live'
}

/** Jour suivant (« 2026-12-31 » → « 2027-01-01 »). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Dernier jour de visibilité (inclus) → instant d'expiration enregistré. */
export function expiryFromLastDay(lastDay: string): string {
  return parisToIso(nextDay(lastDay), '00:00')
}

/** Instant d'expiration enregistré → dernier jour de visibilité (inclus), en heure de Paris. */
export function lastDayFromExpiry(expiresAt: string): string {
  return toParisParts(new Date(Date.parse(expiresAt) - 60_000).toISOString()).date
}

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const dayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' })

/** « mar. 1 déc., 09:00 » */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

/** « 5 décembre 2026 » (jour donné au format AAAA-MM-JJ) */
export function formatDay(date: string): string {
  return dayFormat.format(new Date(`${date}T12:00:00Z`))
}

/** Erreur de saisie des dates d'une annonce, ou null. */
export function checkAnnouncementDates(publishDate: string, publishTime: string, lastDay: string): string | null {
  if (!publishDate || !/^\d{2}:\d{2}$/.test(publishTime)) return 'Indique la date et l’heure de publication.'
  if (lastDay && lastDay < publishDate) return 'La date de fin doit être après la publication.'
  return null
}

/** Valeurs des champs de date pour un instant donné (préremplissage du formulaire). */
export function toDateTimeFields(iso: string): { date: string; time: string } {
  return toParisParts(iso)
}

/** Champs saisis → instant de publication. */
export function publicationFromFields(date: string, time: string): string {
  return parisToIso(date, time)
}
