/**
 * Horaires des matchs : du lundi au vendredi, par tranches de 15 minutes, toujours en heure de Paris
 * (quel que soit le fuseau de l'appareil), sur deux plages : 12:00–13:30 et 17:30–19:00 (bornes incluses).
 * La base applique les mêmes règles (contrainte matches_schedule_slot, fonction set_match_schedule).
 */

export const TIME_ZONE = 'Europe/Paris'
/** Plages horaires autorisées (début et fin inclus). */
export const SLOT_RANGES: ReadonlyArray<readonly [string, string]> = [
  ['12:00', '13:30'],
  ['17:30', '19:00'],
]

/** « 12:00 » → « 12 h », « 13:30 » → « 13 h 30 ». */
export function formatHour(time: string): string {
  const [h, m] = time.split(':')
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`
}

/** Plages en clair : « de 12 h à 13 h 30 ou de 17 h 30 à 19 h ». */
export const SLOT_RANGES_LABEL = SLOT_RANGES.map(([a, b]) => `de ${formatHour(a)} à ${formatHour(b)}`).join(' ou ')

/** Créneaux de 15 minutes entre `first` et `last` inclus (« 12:00 », « 12:15 »…). */
export function rangeSlots(first: string, last: string): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const slots: string[] = []
  for (let m = toMinutes(first); m <= toMinutes(last); m += 15) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return slots
}

/** Créneaux proposés dans le formulaire : toutes les plages autorisées. */
export function timeSlots(): string[] {
  return SLOT_RANGES.flatMap(([first, last]) => rangeSlots(first, last))
}

/** « 12:45 » fait-il partie d'une plage autorisée ? */
export function isAllowedSlot(time: string): boolean {
  return timeSlots().includes(time)
}

/** « 2026-12-02 » est-il un jour du lundi au vendredi ? */
export function isWeekday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

/** Date et heure d'un instant, en heure de Paris : { date: '2026-12-02', time: '12:30' }. */
export function toParisParts(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/** Instant (ISO, UTC) correspondant à une date et une heure de Paris. */
export function parisToIso(date: string, time: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`)
  // Décalage de Paris à cet instant (1 h en hiver, 2 h en été), corrigé une fois autour des changements d'heure.
  const offsetAt = (instant: number) => {
    const { date: d, time: t } = toParisParts(new Date(instant).toISOString())
    return Date.parse(`${d}T${t}:00Z`) - instant
  }
  let utc = naive - offsetAt(naive)
  utc = naive - offsetAt(utc)
  return new Date(utc).toISOString()
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })

/** « mer. 2 déc. · 12:30 » */
export function formatSchedule(iso: string): string {
  return `${dayFormat.format(new Date(iso))} · ${toParisParts(iso).time}`
}

/**
 * Erreur de saisie d'un horaire (date + heure), ou null. Les deux vides = pas d'horaire.
 * `current` : horaire déjà enregistré ; le conserver tel quel reste possible même hors des plages
 * (horaires fixés avant leur mise en place).
 */
export function checkSchedule(date: string, time: string, current?: { date: string; time: string }): string | null {
  if (!date && !time) return null
  if (!date || !time) return 'Indique le jour et l’heure (ou aucun des deux).'
  if (!isWeekday(date)) return 'Les matchs se jouent du lundi au vendredi.'
  if (!/^\d{2}:(00|15|30|45)$/.test(time)) return 'Choisis une heure par tranche de 15 minutes.'
  const unchanged = current !== undefined && current.date === date && current.time === time
  if (!unchanged && !isAllowedSlot(time)) return `Les matchs se jouent ${SLOT_RANGES_LABEL}.`
  return null
}

/**
 * Qui peut modifier le lieu et l'horaire d'un match (affichage ; la base applique les mêmes règles).
 * Joueurs du match : tournoi en cours, match sans résultat. Admin : tournoi en cours ou terminé.
 */
export function canSchedule(
  match: { status: string; homePlayerId: string | null; awayPlayerId: string | null },
  viewer: { isAdmin: boolean; isActivePlayer: boolean; playerId: string | null },
  tournamentStatus: 'draft' | 'in_progress' | 'finished' | 'archived',
): boolean {
  if (match.status === 'bye') return false
  if (viewer.isAdmin) return tournamentStatus === 'in_progress' || tournamentStatus === 'finished'
  const inMatch = Boolean(viewer.playerId && [match.homePlayerId, match.awayPlayerId].includes(viewer.playerId))
  return viewer.isActivePlayer && inMatch && tournamentStatus === 'in_progress' && match.status === 'pending'
}
