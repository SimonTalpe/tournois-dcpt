import { createContext, useContext } from 'react'
import type { AppNotification, ReadTarget } from './api.ts'

export type NotificationsState = {
  notifications: AppNotification[]
  unreadCount: number
  /** Notifications d'annonces non lues (pastille du menu Annonces). */
  unreadAnnouncements: number
  /** Marque comme lues toutes les notifications (ou celles d'une annonce, d'un type, ou une seule). */
  markRead: (target?: ReadTarget) => Promise<void>
}

const EMPTY: NotificationsState = { notifications: [], unreadCount: 0, unreadAnnouncements: 0, markRead: async () => {} }

export const NotificationsContext = createContext<NotificationsState>(EMPTY)

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext)
}
