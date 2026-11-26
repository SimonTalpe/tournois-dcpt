import { useState } from 'react'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { SLOT_RANGES_LABEL, checkSchedule, formatSchedule, parisToIso, timeSlots, toParisParts } from '../../lib/schedule.ts'
import { setSchedule } from './api.ts'
import type { Location, Match } from './types.ts'

type Props = {
  match: Match
  locations: Location[]
  canEdit: boolean
  /** Après un enregistrement : recharger le tournoi (la fenêtre reste ouverte). */
  onSaved: () => Promise<void>
}

const SLOTS = timeSlots()

/** Lieu et horaire d'un match : affichage, et formulaire pour les joueurs du match et l'admin. */
export function ScheduleSection({ match, locations, canEdit, onSaved }: Props) {
  const current = match.scheduled_at ? toParisParts(match.scheduled_at) : { date: '', time: '' }
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(current.date)
  const [time, setTime] = useState(current.time)
  const [locationId, setLocationId] = useState(match.location_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locationName = locations.find((l) => l.id === match.location_id)?.name

  async function save(clear = false) {
    const problem = clear ? null : checkSchedule(date, time, current)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await setSchedule(
        match.id,
        clear || !date ? null : parisToIso(date, time),
        clear || !locationId ? null : locationId,
      )
      await onSaved()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const summary =
    match.scheduled_at || locationName ? (
      <p className="text-sm">
        {match.scheduled_at && <span className="font-semibold">{formatSchedule(match.scheduled_at)}</span>}
        {match.scheduled_at && locationName && ' · '}
        {locationName && <span className="font-semibold">{locationName}</span>}
      </p>
    ) : (
      <p className="text-sm text-muted">Lieu et horaire pas encore fixés.</p>
    )

  return (
    <div className="space-y-2 border-t border-black pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Lieu et horaire</h3>
        {canEdit && !editing && (
          <SecondaryButton onClick={() => setEditing(true)}>{match.scheduled_at || locationName ? 'Modifier' : 'Proposer'}</SecondaryButton>
        )}
      </div>
      {summary}
      {editing && (
        <div className="space-y-2 rounded-xl bg-chalk p-3">
          <p className="text-xs text-muted">Du lundi au vendredi, {SLOT_RANGES_LABEL}. Ton adversaire peut aussi modifier.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Jour</span>
              <input
                type="date"
                className="w-full rounded-xl border border-black bg-white px-3 py-2.5 text-base"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Heure</span>
              <select
                className="w-full rounded-xl border border-black bg-white px-3 py-2.5 text-base"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              >
                <option value="">—</option>
                {(time && !SLOTS.includes(time) ? [time, ...SLOTS] : SLOTS).map((slot) => (
                  <option key={slot} value={slot}>
                    {slot.replace(':', ' h ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="block font-medium">Lieu</span>
            <select
              className="w-full rounded-xl border border-black bg-white px-3 py-2.5 text-base"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <SecondaryButton disabled={busy} onClick={() => void save()}>
              {busy ? 'Patiente…' : 'Enregistrer'}
            </SecondaryButton>
            {(match.scheduled_at || match.location_id) && (
              <SecondaryButton danger disabled={busy} onClick={() => void save(true)}>
                Effacer
              </SecondaryButton>
            )}
            <SecondaryButton disabled={busy} onClick={() => setEditing(false)}>
              Annuler
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  )
}
