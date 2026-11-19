import type { ReactNode } from 'react'
import { RichText } from '../content/RichText.tsx'
import type { Announcement } from './api.ts'
import { formatDateTime, formatDay, lastDayFromExpiry } from './dates.ts'

/** Une annonce (titre, date, contenu riche). */
export function AnnouncementCard({
  announcement,
  highlighted = false,
  badge,
  actions,
}: {
  announcement: Announcement
  highlighted?: boolean
  badge?: ReactNode
  actions?: ReactNode
}) {
  const a = announcement
  return (
    <article
      id={`annonce-${a.id}`}
      className={`scroll-mt-24 space-y-2 rounded-2xl bg-white p-4 shadow-sm ${highlighted ? 'ring-2 ring-ball' : ''}`}
    >
      <header className="space-y-0.5">
        <h2 className="text-lg font-bold text-court">{a.title}</h2>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
          <span>{formatDateTime(a.published_at)}</span>
          {a.expires_at && <span>· jusqu’au {formatDay(lastDayFromExpiry(a.expires_at))}</span>}
          {a.notify && <span title="Les joueurs ont été notifiés">· 🔔</span>}
          {badge}
        </p>
      </header>
      <RichText html={a.body} />
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </article>
  )
}
