import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase.ts'
import { isPlayer, useAuth } from '../auth/AuthContext.ts'
import { listMyNotifications, markNotificationsRead, type AppNotification, type ReadTarget } from './api.ts'
import { NotificationsContext, type NotificationsState } from './NotificationsContext.ts'

/** Les annonces programmées n'émettent pas d'événement à leur publication : relecture périodique. */
const POLL_MS = 5 * 60_000

/** Notifications in-app du joueur connecté, tenues à jour en temps réel. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const userId = !auth.demoMode && isPlayer(auth) ? (auth.profile?.id ?? null) : null
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const load = useCallback(async () => {
    if (!userId) return
    try {
      setNotifications(await listMyNotifications())
    } catch {
      // Erreur passagère : on garde la dernière liste connue.
    }
  }, [userId])

  useEffect(() => {
    if (!supabase || !userId) return
    const client = supabase
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 400)
    }
    const channel = client
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, schedule)
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    const interval = setInterval(schedule, POLL_MS)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      void client.removeChannel(channel)
    }
  }, [userId, load])

  const markRead = useCallback(
    async (target: ReadTarget = {}) => {
      if (!userId) return
      const matches = (n: AppNotification) =>
        !n.read_at &&
        (!target.announcementId || n.announcement_id === target.announcementId) &&
        (!target.kind || n.kind === target.kind) &&
        (!target.notificationId || n.id === target.notificationId)
      if (!notifications.some(matches)) return
      // Affichage immédiat, puis enregistrement.
      const now = new Date().toISOString()
      setNotifications((list) => list.map((n) => (matches(n) ? { ...n, read_at: now } : n)))
      try {
        await markNotificationsRead(target)
      } finally {
        await load()
      }
    },
    [userId, notifications, load],
  )

  const value = useMemo<NotificationsState>(
    () => ({
      notifications: userId ? notifications : [],
      unreadCount: userId ? notifications.filter((n) => !n.read_at).length : 0,
      unreadAnnouncements: userId ? notifications.filter((n) => !n.read_at && n.kind === 'announcement').length : 0,
      markRead,
    }),
    [userId, notifications, markRead],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}
