import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.ts'
import { DISCIPLINE_ICONS, DISCIPLINE_LABELS } from '../tournaments/types.ts'
import { rankedNotificationText, type AppNotification } from './api.ts'
import { formatDateTime } from './dates.ts'
import { useNotifications } from './NotificationsContext.ts'

/** Cloche de l'en-tête : nombre de notifications non lues et liste déroulante. */
export function NotificationBell() {
  const { notifications, unreadCount, markRead } = useNotifications()
  const myProfileId = useAuth().profile?.id ?? null
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  // Fermeture au clic à l'extérieur ou avec Échap.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openNotification(n: AppNotification) {
    setOpen(false)
    if (n.kind === 'ranked_match' && n.ranked_match_id) {
      void markRead({ notificationId: n.id })
      navigate(`/classement?discipline=${n.ranked_match?.discipline ?? 'mini_pong'}&match=${n.ranked_match_id}`)
    } else if (n.announcement_id) {
      void markRead({ announcementId: n.announcement_id })
      navigate(`/annonces#annonce-${n.announcement_id}`)
    }
  }

  const label = unreadCount > 0 ? `Notifications (${unreadCount} non lue${unreadCount > 1 ? 's' : ''})` : 'Notifications'

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative shrink-0 rounded-lg px-2 py-1.5 hover:bg-court-light"
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-clay px-1 text-center text-[10px] leading-4 font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white text-ink shadow-lg ring-1 ring-ink/10">
          <div className="flex items-center justify-between border-b border-ink/10 px-3 py-2">
            <span className="text-sm font-semibold text-court">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="text-xs text-court underline" onClick={() => void markRead()}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink/60">Aucune notification.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-ink/5 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`flex w-full gap-2 px-3 py-2.5 text-left text-sm hover:bg-chalk ${n.read_at ? 'text-ink/60' : ''}`}
                  >
                    {n.kind === 'ranked_match' ? (
                      <>
                        <span aria-hidden="true">{n.recipient_won ? '🏆' : '🏅'}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block ${n.read_at ? '' : 'font-semibold'}`}>
                            {rankedNotificationText(n, myProfileId) ?? 'Match classé'}
                          </span>
                          <span className="block text-xs text-ink/50">
                            {n.ranked_match
                              ? `${DISCIPLINE_ICONS[n.ranked_match.discipline]} Match classé de ${DISCIPLINE_LABELS[n.ranked_match.discipline].toLowerCase()}`
                              : 'Match classé'}{' '}
                            · {formatDateTime(n.created_at)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">📣</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${n.read_at ? '' : 'font-semibold'}`}>
                            {n.announcement?.title ?? 'Nouvelle annonce'}
                          </span>
                          <span className="block text-xs text-ink/50">
                            Annonce · {formatDateTime(n.announcement?.published_at ?? n.created_at)}
                          </span>
                        </span>
                      </>
                    )}
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-clay" aria-label="non lue" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
