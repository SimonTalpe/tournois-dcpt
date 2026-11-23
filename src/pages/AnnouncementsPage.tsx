import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { DemoModeNotice, Notice, PrimaryButton, SecondaryButton } from '../components/ui.tsx'
import { supabase } from '../lib/supabase.ts'
import { isAdmin, useAuth } from '../features/auth/AuthContext.ts'
import { AnnouncementCard } from '../features/announcements/AnnouncementCard.tsx'
import { AnnouncementForm } from '../features/announcements/AnnouncementForm.tsx'
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
} from '../features/announcements/api.ts'
import { announcementState } from '../features/announcements/dates.ts'
import { useNotifications } from '../features/announcements/NotificationsContext.ts'

export function AnnouncementsPage() {
  const auth = useAuth()
  const admin = isAdmin(auth)
  const { hash } = useLocation()
  const { markRead, unreadAnnouncements } = useNotifications()
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [showPast, setShowPast] = useState(false)
  // Instant de référence (programmées / en ligne / expirées), mis à jour à chaque chargement.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      setAnnouncements(await listAnnouncements())
      setNow(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (auth.demoMode || !supabase) return
    const client = supabase
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = client
      .channel('annonces')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => void load(), 400)
      })
      .subscribe()
    return () => {
      clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [load, auth.demoMode])

  // Page consultée : les notifications d'annonces sont lues.
  useEffect(() => {
    if (unreadAnnouncements > 0) void markRead({ kind: 'announcement' })
  }, [unreadAnnouncements, markRead])

  // Arrivée depuis une notification : on fait défiler jusqu'à l'annonce.
  const targetId = hash.startsWith('#annonce-') ? hash.slice('#annonce-'.length) : null
  useEffect(() => {
    if (targetId && announcements) document.getElementById(`annonce-${targetId}`)?.scrollIntoView({ behavior: 'smooth' })
  }, [targetId, announcements])

  if (auth.demoMode) {
    return (
      <section className="space-y-4">
        <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">Annonces</h1>
        <DemoModeNotice />
      </section>
    )
  }

  const at = new Date(now)
  const live = (announcements ?? []).filter((a) => announcementState(a, at) === 'live')
  const scheduled = (announcements ?? [])
    .filter((a) => announcementState(a, at) === 'scheduled')
    .sort((a, b) => a.published_at.localeCompare(b.published_at))
  const expired = (announcements ?? []).filter((a) => announcementState(a, at) === 'expired')

  async function remove(a: Announcement) {
    if (!window.confirm(`Supprimer l’annonce « ${a.title} » ? Cette action est définitive.`)) return
    try {
      await deleteAnnouncement(a.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const renderCard = (a: Announcement, badge?: string, featured = false) =>
    editing === a.id ? (
      <section key={a.id} className="space-y-3 rounded-2xl bg-white p-4 border-2 border-black">
        <h2 className="font-display text-[30px] leading-none font-extrabold">Modifier l’annonce</h2>
        <AnnouncementForm
          initial={a}
          submitLabel="Enregistrer"
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            await updateAnnouncement(a.id, input)
            setEditing(null)
            await load()
          }}
        />
      </section>
    ) : (
      <AnnouncementCard
        key={a.id}
        announcement={a}
        highlighted={a.id === targetId}
        featured={featured}
        badge={badge ? <span className="border border-black bg-white px-2 py-0.5 font-semibold text-black">{badge}</span> : undefined}
        actions={
          admin ? (
            <>
              <SecondaryButton onClick={() => setEditing(a.id)}>Modifier</SecondaryButton>
              <SecondaryButton danger onClick={() => void remove(a)}>
                Supprimer
              </SecondaryButton>
            </>
          ) : undefined
        }
      />
    )

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">Annonces</h1>
        {admin && editing !== 'new' && (
          <div className="w-auto">
            <PrimaryButton type="button" onClick={() => setEditing('new')}>
              Publier une annonce
            </PrimaryButton>
          </div>
        )}
      </div>

      {editing === 'new' && (
        <section className="space-y-3 border-2 border-black bg-mist p-5">
          <h2 className="font-display text-[30px] leading-none font-extrabold">Nouvelle annonce</h2>
          <AnnouncementForm
            submitLabel="Publier"
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => {
              await createAnnouncement(input)
              setEditing(null)
              await load()
            }}
          />
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!announcements ? (
        <p className="text-muted">Chargement…</p>
      ) : (
        <>
          {admin && scheduled.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[15px] font-bold">Programmées (visibles par toi seul)</h2>
              <div className="space-y-3">{scheduled.map((a) => renderCard(a, 'Programmée'))}</div>
            </section>
          )}
          {live.length === 0 ? (
            <div className="border-2 border-dashed border-black p-6 text-[17px]">
              Aucune annonce pour le moment.{admin ? ' Publie la première avec « Publier une annonce ».' : ''}
            </div>
          ) : (
            <div className="space-y-4">{live.map((a, i) => renderCard(a, undefined, i === 0))}</div>
          )}
          {admin && expired.length > 0 && (
            <section className="space-y-2">
              <button type="button" className="min-h-11 text-[15px] font-semibold text-ochre-text underline" onClick={() => setShowPast((v) => !v)}>
                {showPast ? 'Masquer les annonces passées' : `Annonces passées (${expired.length})`}
              </button>
              {showPast && <div className="space-y-3 opacity-80">{expired.map((a) => renderCard(a, 'Expirée'))}</div>}
            </section>
          )}
        </>
      )}
    </section>
  )
}
