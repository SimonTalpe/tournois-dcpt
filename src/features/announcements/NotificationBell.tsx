import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.ts'
import { DISCIPLINE_LABELS } from '../tournaments/types.ts'
import { rankedNotificationText, type AppNotification } from './api.ts'
import { formatDateTime } from './dates.ts'
import { Icon } from '../../components/ui.tsx'
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
        className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center text-black hover:bg-mist"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ochre px-1 text-[11px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden border-2 border-black bg-white text-black">
          <div className="flex items-center justify-between border-b border-black px-3 py-2">
            <span className="font-display text-2xl font-black">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="text-xs text-ochre-text underline" onClick={() => void markRead()}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">Aucune notification.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`flex min-h-11 w-full gap-2 border-b border-black px-3 py-3 text-left text-[15px] leading-snug hover:bg-mist ${n.read_at ? '' : 'bg-ochre-tint'}`}
                  >
                    {n.kind === 'ranked_match' ? (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className={`block ${n.read_at ? '' : 'font-semibold'}`}>
                            {rankedNotificationText(n, myProfileId) ?? 'Match classé'}
                          </span>
                          <span className="block text-[13px] text-muted">
                            {n.ranked_match
                              ? `Match classé de ${DISCIPLINE_LABELS[n.ranked_match.discipline].toLowerCase()}`
                              : 'Match classé'}{' '}
                            · {formatDateTime(n.created_at)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${n.read_at ? '' : 'font-semibold'}`}>
                            {n.announcement?.title ?? 'Nouvelle annonce'}
                          </span>
                          <span className="block text-[13px] text-muted">
                            Annonce · {formatDateTime(n.announcement?.published_at ?? n.created_at)}
                          </span>
                        </span>
                      </>
                    )}
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ochre" aria-label="non lue" />}
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
