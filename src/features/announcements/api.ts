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
  kind: 'announcement' | 'ranked_match'
  announcement_id: string | null
  ranked_match_id: string | null
  created_at: string
  read_at: string | null
  /** Match classé : écart d'Elo et résultat du destinataire, auteur de la saisie. */
  elo_delta: number | null
  recipient_won: boolean | null
  actor_id: string | null
  actor: { full_name: string } | null
  announcement: { title: string; published_at: string } | null
  ranked_match: {
    discipline: 'mini_pong' | 'darts'
    home: { full_name: string; profile_id: string | null } | null
    away: { full_name: string; profile_id: string | null } | null
  } | null
}

/** Notifications de la session (annonces en ligne, matchs classés), les plus récentes d'abord. */
export async function listMyNotifications(): Promise<AppNotification[]> {
  const rows = check(
    await db()
      .from('notifications')
      .select(
        'id, kind, announcement_id, ranked_match_id, created_at, read_at, elo_delta, recipient_won, actor_id, ' +
          'actor:profiles!notifications_actor_id_fkey(full_name), ' +
          'announcement:announcements(title, published_at), ' +
          'ranked_match:ranked_matches(discipline, ' +
          'home:players!ranked_matches_home_player_id_fkey(full_name, profile_id), ' +
          'away:players!ranked_matches_away_player_id_fkey(full_name, profile_id))',
      )
      .order('created_at', { ascending: false })
      .limit(50),
  ) as unknown as AppNotification[]
  const when = (n: AppNotification) => n.announcement?.published_at ?? n.created_at
  return rows.sort((a, b) => when(b).localeCompare(when(a)))
}

/** Ce qui est marqué comme lu : tout, une annonce, un type de notification ou une notification. */
export type ReadTarget = { announcementId?: string; kind?: AppNotification['kind']; notificationId?: string }

export async function markNotificationsRead(target: ReadTarget = {}): Promise<void> {
  check(
    await db().rpc('mark_notifications_read', {
      p_announcement_id: target.announcementId ?? null,
      p_kind: target.kind ?? null,
      p_notification_id: target.notificationId ?? null,
    }),
  )
}

/** Texte d'une notification de match classé, pour son destinataire (null si autre type). */
export function rankedNotificationText(n: AppNotification, myProfileId: string | null): string | null {
  if (n.kind !== 'ranked_match' || !n.ranked_match) return null
  const { home, away } = n.ranked_match
  const opponent = home?.profile_id === myProfileId ? away : home
  const actor = n.actor?.full_name ?? 'Quelqu’un'
  const actorIsOpponent = Boolean(opponent?.profile_id && opponent.profile_id === n.actor_id)
  const result = n.recipient_won ? 'victoire' : 'défaite'
  const delta = n.elo_delta === null ? '' : ` (${n.elo_delta > 0 ? '+' : n.elo_delta < 0 ? '−' : '±'}${Math.abs(n.elo_delta)} Elo)`
  if (actorIsOpponent) {
    return `${actor} a enregistré ${n.recipient_won ? 'sa défaite' : 'sa victoire'} contre toi${delta}`
  }
  return `${actor} a enregistré ta ${result} contre ${opponent?.full_name ?? 'ton adversaire'}${delta}`
}
