import { useState, type FormEvent } from 'react'
import { Notice, PrimaryButton, TextField } from '../../components/ui.tsx'
import { toParisParts } from '../../lib/schedule.ts'
import { LazyRichTextEditor as RichTextEditor } from '../content/LazyRichTextEditor.tsx'
import type { Announcement, AnnouncementInput } from './api.ts'
import {
  checkAnnouncementDates,
  expiryFromLastDay,
  lastDayFromExpiry,
  publicationFromFields,
  toDateTimeFields,
} from './dates.ts'

type Props = {
  /** Annonce modifiée (absente pour une création). */
  initial?: Announcement
  submitLabel: string
  onSubmit: (input: AnnouncementInput) => Promise<void>
  onCancel: () => void
}

/** Création / modification d'une annonce (admin). */
export function AnnouncementForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [start] = useState(() =>
    initial ? toDateTimeFields(initial.published_at) : toParisParts(new Date().toISOString()),
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [publishDate, setPublishDate] = useState(start.date)
  const [publishTime, setPublishTime] = useState(start.time)
  const [lastDay, setLastDay] = useState(initial?.expires_at ? lastDayFromExpiry(initial.expires_at) : '')
  const [notify, setNotify] = useState(initial?.notify ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 2) return setError('Donne un titre à l’annonce (2 caractères minimum).')
    const dateError = checkAnnouncementDates(publishDate, publishTime, lastDay)
    if (dateError) return setError(dateError)
    setBusy(true)
    try {
      await onSubmit({
        title,
        body,
        published_at: publicationFromFields(publishDate, publishTime),
        expires_at: lastDay ? expiryFromLastDay(lastDay) : null,
        notify,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-black px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ochre'

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <TextField
        label="Titre"
        name="announcementTitle"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="ex. Les tournois commencent lundi !"
      />
      <div className="space-y-1">
        <label htmlFor="announcementBody" className="block text-sm font-medium">
          Contenu
        </label>
        <RichTextEditor
          id="announcementBody"
          initialValue={body}
          onChange={setBody}
          placeholder="Règles, horaires, lots, informations pratiques…"
        />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Publication (heure de Paris)</legend>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="date"
            aria-label="Date de publication"
            className={inputClass}
            value={publishDate}
            onChange={(e) => setPublishDate(e.target.value)}
          />
          <input
            type="time"
            aria-label="Heure de publication"
            className={inputClass}
            value={publishTime}
            onChange={(e) => setPublishTime(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted">Une date future programme l’annonce : elle n’apparaîtra qu’à ce moment-là.</p>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="announcementLastDay" className="block text-sm font-medium">
          Visible jusqu’au (inclus) — facultatif
        </label>
        <div className="flex gap-2">
          <input
            id="announcementLastDay"
            type="date"
            className={inputClass}
            value={lastDay}
            min={publishDate}
            onChange={(e) => setLastDay(e.target.value)}
          />
          {lastDay && (
            <button type="button" className="shrink-0 text-sm text-muted underline" onClick={() => setLastDay('')}>
              Sans fin
            </button>
          )}
        </div>
        <p className="text-xs text-muted">Après cette date, l’annonce disparaît pour les joueurs et spectateurs.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>
          <span className="font-medium">Notifier les joueurs</span>
          <span className="block text-xs text-muted">
            Notification dans le site (cloche) pour chaque compte actif, à la publication.
          </span>
        </span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <PrimaryButton busy={busy}>{submitLabel}</PrimaryButton>
        </div>
        <button type="button" className="text-sm text-muted underline" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  )
}
