import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { DemoModeNotice, Notice } from '../components/ui.tsx'
import { listAnnouncements, type Announcement } from '../features/announcements/api.ts'
import { announcementState, formatDateTime } from '../features/announcements/dates.ts'
import { isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { excerpt } from '../features/content/richText.ts'
import {
  myTournamentsInProgress,
  myUpcomingMatches,
  progress,
  recentResults,
  type MyMatch,
  type RecentResult,
} from '../features/home/home.ts'
import { listTournaments, loadTournament } from '../features/tournaments/api.ts'
import { DISCIPLINE_ICONS, DISCIPLINE_LABELS, type TournamentBundle } from '../features/tournaments/types.ts'
import { formatSchedule } from '../lib/schedule.ts'
import { useLiveReload } from '../lib/useLiveReload.ts'

type HomeData = {
  /** Tournois en cours (ou, à défaut, les derniers terminés), chargés en entier. */
  bundles: TournamentBundle[]
  announcements: Announcement[]
}

const LIVE_TABLES = ['tournaments', 'tournament_entries', 'tournament_rounds', 'matches', 'announcements'] as const

async function loadHome(): Promise<HomeData> {
  const [tournaments, announcements] = await Promise.all([listTournaments(), listAnnouncements()])
  const inProgress = tournaments.filter((t) => t.status === 'in_progress')
  // Aucun tournoi en cours : on charge les deux derniers terminés pour leurs résultats.
  const shown = inProgress.length
    ? inProgress
    : tournaments
        .filter((t) => t.status === 'finished')
        .sort((a, b) => (b.launched_at ?? '').localeCompare(a.launched_at ?? ''))
        .slice(0, 2)
  const bundles = (await Promise.all(shown.map((t) => loadTournament(t.id)))).filter(
    (b): b is TournamentBundle => b !== null,
  )
  const now = new Date()
  return {
    bundles,
    announcements: announcements.filter((a) => announcementState(a, now) === 'live').slice(0, 3),
  }
}

export function HomePage() {
  const auth = useAuth()
  const player = isPlayer(auth)
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await loadHome())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (auth.demoMode) return
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load, auth.demoMode])
  useLiveReload('accueil', LIVE_TABLES, () => void load(), !auth.demoMode)

  if (auth.demoMode) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-court">Accueil</h1>
        <DemoModeNotice />
      </section>
    )
  }

  const firstName = auth.profile?.full_name.split(' ')[0]
  const profileId = auth.profile?.id ?? null
  const inProgress = data?.bundles.filter((b) => b.tournament.status === 'in_progress') ?? []
  const myMatches = data && player ? myUpcomingMatches(data.bundles, profileId) : []
  const myTournaments = data && player ? myTournamentsInProgress(data.bundles, profileId) : []
  const results = data ? recentResults(data.bundles, 5) : []

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold text-court">{firstName ? `Salut ${firstName} 👋` : 'Bienvenue 👋'}</h1>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <p className="text-ink/60">Chargement…</p>
      ) : (
        <>
          {myTournaments.length > 0 && (
            <HomeSection title="Mes prochains matchs">
              {myMatches.length === 0 ? (
                <div className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm">
                  <p>Pas de match à jouer pour le moment.</p>
                  <ul className="space-y-1">
                    {myTournaments.map((t) => (
                      <li key={t.id}>
                        <Link to={`/tournois/${t.id}`} className="text-court underline">
                          Voir le tableau — {t.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {myMatches.map((m) => (
                    <li key={m.match.id}>
                      <MyMatchCard item={m} />
                    </li>
                  ))}
                </ul>
              )}
            </HomeSection>
          )}

          {data.announcements.length > 0 && (
            <HomeSection title="Annonces" more={{ to: '/annonces', label: 'Toutes les annonces' }}>
              <ul className="space-y-2">
                {data.announcements.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/annonces#annonce-${a.id}`}
                      className="block rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-md"
                    >
                      <span className="block font-semibold text-court">📣 {a.title}</span>
                      <span className="block text-xs text-ink/50">{formatDateTime(a.published_at)}</span>
                      {a.body && <span className="mt-1 block text-sm text-ink/70">{excerpt(a.body)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </HomeSection>
          )}

          <HomeSection title="Tournois en cours" more={{ to: '/tournois', label: 'Tous les tournois' }}>
            {inProgress.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-court/30 bg-white p-4 text-sm text-ink/70">
                Aucun tournoi en cours pour le moment.
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {inProgress.map((b) => {
                  const { done, total } = progress(b)
                  return (
                    <li key={b.tournament.id}>
                      <Link
                        to={`/tournois/${b.tournament.id}`}
                        className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-md"
                      >
                        <span className="text-3xl" aria-hidden="true">
                          {DISCIPLINE_ICONS[b.tournament.discipline]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-court">{b.tournament.name}</span>
                          <span className="block text-sm text-ink/60">
                            {DISCIPLINE_LABELS[b.tournament.discipline]} · {b.entries.length} joueurs
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-court/10">
                            <span
                              className="block h-full rounded-full bg-court"
                              style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
                            />
                          </span>
                          <span className="block pt-0.5 text-xs text-ink/50">
                            {done}/{total} matchs joués
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </HomeSection>

          {results.length > 0 && (
            <HomeSection title="Derniers résultats">
              <ul className="divide-y divide-ink/5 overflow-hidden rounded-2xl bg-white shadow-sm">
                {results.map((r) => (
                  <li key={r.match.id}>
                    <ResultRow result={r} />
                  </li>
                ))}
              </ul>
            </HomeSection>
          )}
        </>
      )}
    </section>
  )
}

function HomeSection({
  title,
  more,
  children,
}: {
  title: string
  more?: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink/60 uppercase">{title}</h2>
        {more && (
          <Link to={more.to} className="text-sm text-court underline">
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function MyMatchCard({ item }: { item: MyMatch }) {
  const { match, tournament } = item
  return (
    <Link
      to={`/tournois/${tournament.id}?match=${match.id}`}
      className="block space-y-1.5 rounded-2xl bg-white p-4 shadow-sm transition hover:shadow-md"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-ink/60">
        <span className="truncate">
          {DISCIPLINE_ICONS[tournament.discipline]} {tournament.name} · {item.roundLabel}
        </span>
        <span className="shrink-0 text-court">ouvrir ›</span>
      </span>
      <span className="block text-lg font-semibold">
        <span className="text-ink/50">contre </span>
        <span className={item.opponentKnown ? '' : 'text-ink/50 italic'}>{item.opponent}</span>
      </span>
      {match.scheduled_at || item.locationName ? (
        <span className="block rounded-lg bg-ball/30 px-2 py-1 text-sm">
          📅 {match.scheduled_at ? formatSchedule(match.scheduled_at) : 'Horaire à fixer'}
          {item.locationName ? ` · 📍 ${item.locationName}` : ''}
        </span>
      ) : (
        <span className="block text-sm text-ink/60">
          {item.opponentKnown ? 'Horaire et lieu à fixer — propose-les depuis le match.' : 'En attente de ton adversaire.'}
        </span>
      )}
    </Link>
  )
}

function ResultRow({ result }: { result: RecentResult }) {
  const { match, tournament } = result
  const winnerIsHome = match.winner_player_id === match.home_player_id
  return (
    <Link to={`/tournois/${tournament.id}?match=${match.id}`} className="block px-4 py-2.5 hover:bg-chalk">
      <span className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span className={winnerIsHome ? 'font-semibold' : ''}>{result.home}</span>
          <span className="px-1.5 text-ink/50 tabular-nums">
            {result.score ? `${result.score.home} – ${result.score.away}` : 'vs'}
          </span>
          <span className={!winnerIsHome ? 'font-semibold' : ''}>{result.away}</span>
        </span>
        {result.forfeitName && <span className="shrink-0 text-xs font-semibold text-clay uppercase">forfait</span>}
      </span>
      <span className="block truncate text-xs text-ink/50">
        {DISCIPLINE_ICONS[tournament.discipline]} {tournament.name} · {result.roundLabel}
      </span>
    </Link>
  )
}
