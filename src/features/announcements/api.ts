import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'

export class ContentError extends Error {}

function db(): SupabaseClient {
  if (!supabase) throw new ContentError("Le site n'est pas relié à la base de données.")
  return supabase
}

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new ContentError(translateError(result.error))
  return result.data
}

export type Announcement = {
  id: string
  title: string
  body: string
  published_at: string
  expires_at: string | null
  notify: boolean
  created_at: string
}

/** Champs modifiables par l'admin. */
export type AnnouncementInput = Pick<Announcement, 'title' | 'body' | 'published_at' | 'expires_at' | 'notify'>

const COLUMNS = 'id, title, body, published_at, expires_at, notify, created_at'

/** Annonces lisibles (joueurs et spectateurs : en ligne ; admin : toutes), les plus récentes d'abord. */
export async function listAnnouncements(): Promise<Announcement[]> {
  return check(await db().from('announcements').select(COLUMNS).order('published_at', { ascending: false })) as Announcement[]
}

function pickInput(input: AnnouncementInput): AnnouncementInput {
  const { title, body, published_at, expires_at, notify } = input
  return { title: title.trim(), body, published_at, expires_at, notify }
}

export async function createAnnouncement(input: AnnouncementInput): Promise<void> {
  check(await db().from('announcements').insert(pickInput(input)))
}

export async function updateAnnouncement(id: string, input: AnnouncementInput): Promise<void> {
  check(await db().from('announcements').update(pickInput(input)).eq('id', id))
}

export async function deleteAnnouncement(id: string): Promise<void> {
  check(await db().from('announcements').delete().eq('id', id))
}

// ---------------------------------------------------------------- Notifications

export type AppNotification = {
  id: string
  kind: 'announcement'
  announcement_id: string | null
  created_at: string
  read_at: string | null
  announcement: { title: string; published_at: string } | null
}

/** Notifications de la session (annonces en ligne uniquement), les plus récentes d'abord. */
export async function listMyNotifications(): Promise<AppNotification[]> {
  const rows = check(
    await db()
      .from('notifications')
      .select('id, kind, announcement_id, created_at, read_at, announcement:announcements(title, published_at)')
      .limit(50),
  ) as unknown as AppNotification[]
  const when = (n: AppNotification) => n.announcement?.published_at ?? n.created_at
  return rows.sort((a, b) => when(b).localeCompare(when(a)))
}

/** Marque comme lues toutes les notifications (ou celles d'une annonce). */
export async function markNotificationsRead(announcementId?: string): Promise<void> {
  check(await db().rpc('mark_notifications_read', { p_announcement_id: announcementId ?? null }))
}
