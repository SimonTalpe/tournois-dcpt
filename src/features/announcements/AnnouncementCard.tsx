import type { ReactNode } from 'react'
import { RichText } from '../content/RichText.tsx'
import type { Announcement } from './api.ts'
import { formatDateTime, formatDay, lastDayFromExpiry } from './dates.ts'

/** Une annonce (titre, date, contenu riche). */
export function AnnouncementCard({
  announcement,
  highlighted = false,
  featured = false,
  badge,
  actions,
}: {
  announcement: Announcement
  highlighted?: boolean
  /** Annonce « à la une » : la plus récente, en grand sur fond ocre. */
  featured?: boolean
  badge?: ReactNode
  actions?: ReactNode
}) {
  const a = announcement
  return (
    <article
      id={`annonce-${a.id}`}
      className={`scroll-mt-24 space-y-3 ${
        featured ? 'announcement-featured bg-ochre p-6 text-white sm:p-8' : 'border-2 border-black p-4 sm:p-5'
      } ${highlighted ? 'outline-[3px] outline-offset-2 outline-black outline-solid' : ''}`}
    >
      <header className="space-y-1">
        {featured && <p className="text-[13px] font-semibold">À la une</p>}
        <h2
          className={`font-display leading-[0.9] font-black ${featured ? 'text-[40px] sm:text-[64px]' : 'text-[30px] font-extrabold'}`}
        >
          {a.title}
        </h2>
        <p className={`flex flex-wrap items-center gap-x-2 text-[13px] ${featured ? 'text-white' : 'text-muted'}`}>
          <span>Publiée le {formatDateTime(a.published_at)}</span>
          {a.expires_at && <span>, jusqu’au {formatDay(lastDayFromExpiry(a.expires_at))}</span>}
          {a.notify && <span>, joueurs notifiés</span>}
          {badge}
        </p>
      </header>
      <RichText html={a.body} className={featured ? 'max-w-[65ch] text-[17px] leading-relaxed' : 'max-w-[65ch]'} />
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </article>
  )
}
