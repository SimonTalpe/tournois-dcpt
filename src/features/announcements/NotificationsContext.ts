import { createContext, useContext } from 'react'
import type { AppNotification } from './api.ts'

export type NotificationsState = {
  notifications: AppNotification[]
  unreadCount: number
  /** Marque comme lues toutes les notifications (ou celles d'une annonce). */
  markRead: (announcementId?: string) => Promise<void>
}

const EMPTY: NotificationsState = { notifications: [], unreadCount: 0, markRead: async () => {} }

export const NotificationsContext = createContext<NotificationsState>(EMPTY)

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext)
}
