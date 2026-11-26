import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { plural } from '../lib/french.ts'
import { Link } from 'react-router'
import { DemoModeNotice, Notice, SectionTitle } from '../components/ui.tsx'
import { listAnnouncements, type Announcement } from '../features/announcements/api.ts'
import { announcementState, formatDateTime } from '../features/announcements/dates.ts'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { excerpt } from '../features/content/richText.ts'
import {
  dayTitle,
  daySchedule,
  frenchTime,
  myTournamentsInProgress,
  myUpcomingMatches,
  programDay,
  progress,
  recentResults,
  relativeSchedule,
  unscheduledMatches,
  type MyMatch,
  type ProgramItem,
  type RecentResult,
} from '../features/home/home.ts'
import { listTournaments, loadTournament } from '../features/tournaments/api.ts'
import { DISCIPLINE_LABELS, type TournamentBundle } from '../features/tournaments/types.ts'
import { toParisParts } from '../lib/schedule.ts'
import { useLiveReload } from '../lib/useLiveReload.ts'

type HomeData = {
  /** Tournois en cours (ou, à défaut, les derniers terminés), chargés en entier. */
  bundles: TournamentBundle[]
  announcements: Announcement[]
  /** Date du jour à Paris (« 2026-11-23 »), fixée au chargement. */
  today: string
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
    today: toParisParts(now.toISOString()).date,
  }
}

const matchLink = (item: { tournament: { id: string }; match: { id: string } }) =>
  `/tournois/${item.tournament.id}?match=${item.match.id}`

/**
 * Accueil, design « Ordre du jeu » : la date du jour en très grand, tes matchs (ou le prochain match pour
 * les spectateurs), puis le programme de la pause, lisible d'un coup d'œil.
 */
export function HomePage() {
  const auth = useAuth()
  const player = isPlayer(auth)
  const admin = isAdmin(auth)
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
        <h1 className="font-display text-[56px] leading-[0.9] font-black">Accueil</h1>
        <DemoModeNotice />
      </section>
    )
  }

  const today = data?.today ?? null
  const { weekday, dayMonth } = today ? dayTitle(today) : { weekday: 'Mini-pong', dayMonth: 'et fléchettes' }
  const profileId = auth.profile?.id ?? null
  const bundles = data?.bundles ?? []
  const inProgress = bundles.filter((b) => b.tournament.status === 'in_progress')
  const myMatches = data && player ? myUpcomingMatches(bundles, profileId) : []
  const myTournaments = data && player ? myTournamentsInProgress(bundles, profileId) : []
  const shownDay = data && today ? programDay(bundles, today) : null
  const program = shownDay ? daySchedule(bundles, profileId, shownDay) : []
  const todayCount = shownDay === today ? program.length : 0
  const nextMatch = program.find((i) => i.match.status === 'pending') ?? null
  const results = data ? recentResults(bundles, 5) : []
  const toSchedule = data && admin ? unscheduledMatches(bundles) : 0

  const intro = !data
    ? 'Chargement…'
    : todayCount === 0
      ? 'Pas de match programmé à la pause aujourd’hui.'
      : `${todayCount} match${todayCount > 1 ? 's' : ''} à la pause aujourd’hui.${
          player ? ' Passe voir, il y a toujours de la place pour le public.' : ' Choisis ton étage et viens encourager les joueurs.'
        }`

  return (
    <div className="space-y-10">
      <section className="grid grid-cols-1 items-end gap-8 border-b-4 border-black pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <div>
          <h1 className="font-display text-[64px] leading-[0.86] font-black sm:text-[96px] lg:text-[136px]">
            {weekday}
            <br />
            {dayMonth}
          </h1>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-normal sm:text-[19px]">{intro}</p>
        </div>
        {player && today && myTournaments.length > 0 && <MyMatchesBox matches={myMatches} today={today} />}
        {!player && nextMatch && <NextMatchBox item={nextMatch} />}
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      {admin && data && <AdminBox toSchedule={toSchedule} />}

      {data && shownDay && (
        <section aria-labelledby="programme" className="space-y-2">
          <SectionTitle id="programme">
            {shownDay === today ? 'Programme de la pause' : `Programme du ${dayTitle(shownDay).weekday.toLowerCase()} ${dayTitle(shownDay).dayMonth}`}
          </SectionTitle>
          <ol className="border-t-4 border-black">
            {program.map((item) => (
              <li key={item.match.id}>
                <ProgramRow item={item} highlight={player ? item.isMine : item === nextMatch} />
              </li>
            ))}
          </ol>
          <p className="pt-2">
            <Link to="/tournois" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ochre-text">
              Voir les tournois en entier
            </Link>
          </p>
        </section>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
          {data.announcements.length > 0 && (
            <HomeBlock title="Annonces" more={{ to: '/annonces', label: 'Toutes les annonces' }}>
              <ul className="space-y-4">
                {data.announcements.map((a) => (
                  <li key={a.id} className="border-l-4 border-ochre pl-4">
                    <Link to={`/annonces#annonce-${a.id}`} className="block text-black">
                      <span className="block text-lg leading-snug font-bold">{a.title}</span>
                      {a.body && <span className="mt-1 block text-[15px] leading-normal">{excerpt(a.body)}</span>}
                      <span className="mt-1 block text-[13px] text-muted">{formatDateTime(a.published_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </HomeBlock>
          )}

          <HomeBlock title="Tournois en cours" more={{ to: '/tournois', label: 'Tous les tournois' }}>
            {inProgress.length === 0 ? (
              <p className="border-2 border-dashed border-black p-4 text-[15px]">Aucun tournoi en cours pour le moment.</p>
            ) : (
              <ul className="space-y-3">
                {inProgress.map((b) => {
                  const { done, total } = progress(b)
                  const dark = b.tournament.discipline === 'mini_pong'
                  return (
                    <li key={b.tournament.id}>
                      <Link
                        to={`/tournois/${b.tournament.id}`}
                        className={`block p-4 text-white ${dark ? 'bg-black' : 'bg-ochre'}`}
                      >
                        <span className="block text-sm font-semibold">
                          {DISCIPLINE_LABELS[b.tournament.discipline]}, {plural(b.entries.length, 'joueur')}
                        </span>
                        <span className="mt-1 block font-display text-[32px] leading-[0.9] font-black">{b.tournament.name}</span>
                        <span className="mt-1.5 block text-sm">
                          {done} match{done > 1 ? 's' : ''} joué{done > 1 ? 's' : ''} sur {total}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </HomeBlock>

          {results.length > 0 && (
            <HomeBlock title="Derniers résultats">
              <ul className="border-t-2 border-black">
                {results.map((r) => (
                  <li key={r.match.id}>
                    <ResultRow result={r} />
                  </li>
                ))}
              </ul>
            </HomeBlock>
          )}
        </div>
      )}
    </div>
  )
}

function HomeBlock({ title, more, children }: { title: string; more?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      {children}
      {more && (
        <Link to={more.to} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ochre-text">
          {more.label}
        </Link>
      )}
    </section>
  )
}

/** Bloc noir « Tes matchs » : les deux prochains matchs du joueur. */
function MyMatchesBox({ matches, today }: { matches: MyMatch[]; today: string }) {
  return (
    <aside aria-labelledby="tes-matchs" className="flex flex-col gap-3.5 bg-black p-6 text-white">
      <h2 id="tes-matchs" className="text-lg font-bold">
        Tes matchs
      </h2>
      {matches.length === 0 ? (
        <p className="text-[15px]">Pas de match à jouer pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {matches.slice(0, 2).map((m) => (
            <li key={m.match.id}>
              <Link to={matchLink(m)} className="block text-white">
                <span className="block font-display text-[28px] leading-none font-extrabold">
                  {m.match.scheduled_at ? relativeSchedule(m.match.scheduled_at, today) : 'Horaire à proposer'}
                </span>
                <span className="mt-0.5 block text-[15px]">
                  {DISCIPLINE_LABELS[m.tournament.discipline]} contre {m.opponent}
                  {m.locationName ? `, ${m.locationName}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {matches.length > 2 && <p className="text-sm">Et {matches.length - 2} autre{matches.length > 3 ? 's' : ''} à jouer.</p>}
    </aside>
  )
}

/** Bloc noir « Prochain match » (spectateurs et joueurs hors tournoi). */
function NextMatchBox({ item }: { item: ProgramItem }) {
  return (
    <aside aria-labelledby="prochain-match" className="bg-black p-6 text-white">
      <Link to={matchLink(item)} className="flex flex-col gap-2 text-white">
        <h2 id="prochain-match" className="text-lg font-bold">
          Prochain match
        </h2>
        <span className="font-display text-[44px] leading-[0.95] font-extrabold">
          {frenchTime(item.time)}
          {item.locationName ? `, ${item.locationName}` : ''}
        </span>
        <span className="text-[17px] leading-snug">
          {item.home} contre {item.away}
        </span>
        <span className="text-[15px]">
          {DISCIPLINE_LABELS[item.tournament.discipline]}, {item.roundLabel}
        </span>
      </Link>
    </aside>
  )
}

/** Bloc gris réservé à l'admin. */
function AdminBox({ toSchedule }: { toSchedule: number }) {
  return (
    <section aria-labelledby="a-regler" className="grid grid-cols-1 gap-6 bg-mist p-5 sm:p-8 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
      <div>
        <SectionTitle id="a-regler" className="mb-3">
          À régler
        </SectionTitle>
        <ul className="border-t border-black">
          <li className="flex flex-wrap items-center justify-between gap-3 border-b border-black py-3.5">
            <span className="text-base leading-normal">
              {toSchedule === 0
                ? 'Tous les matchs à jouer ont un horaire.'
                : `${toSchedule} match${toSchedule > 1 ? 's' : ''} à jouer ${toSchedule > 1 ? "n'ont" : "n'a"} pas encore d'horaire.`}
            </span>
            <Link to="/tournois" className="inline-flex min-h-11 items-center border-2 border-black px-4 text-[15px] font-semibold text-black hover:bg-black hover:text-white">
              Voir les tournois
            </Link>
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-2.5">
        <SectionTitle>Raccourcis</SectionTitle>
        <Link to="/tournois?nouveau=1" className="flex min-h-11 items-center justify-center border-2 border-black bg-black px-4 text-[15px] font-semibold text-white hover:bg-ochre-text">
          Créer un tournoi
        </Link>
        <Link to="/annonces" className="flex min-h-11 items-center justify-center border-2 border-black px-4 text-[15px] font-semibold text-black hover:bg-black hover:text-white">
          Publier une annonce
        </Link>
        <Link to="/admin" className="flex min-h-11 items-center justify-center border-2 border-black px-4 text-[15px] font-semibold text-black hover:bg-black hover:text-white">
          Comptes, accès et lieux
        </Link>
      </div>
    </section>
  )
}

function ProgramRow({ item, highlight }: { item: ProgramItem; highlight: boolean }) {
  const { match } = item
  const played = match.status === 'played' || match.status === 'walkover'
  const homeWon = match.winner_player_id !== null && match.winner_player_id === match.home_player_id
  const awayWon = match.winner_player_id !== null && match.winner_player_id === match.away_player_id
  const status =
    match.status === 'walkover'
      ? 'Forfait'
      : played
        ? item.score
          ? `Terminé, ${item.score.home}-${item.score.away}`
          : 'Terminé'
        : 'À jouer'
  return (
    <Link
      to={matchLink(item)}
      className={`grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b px-3 py-4 sm:grid-cols-[150px_130px_minmax(0,1fr)_minmax(140px,200px)] sm:gap-x-6 ${
        highlight ? 'border-ochre bg-ochre text-white' : 'border-black text-black hover:bg-mist'
      }`}
    >
      <span
        className={`row-span-3 self-start font-display text-[38px] leading-[0.9] font-extrabold sm:row-span-1 sm:self-center sm:text-[52px] ${
          highlight ? 'text-white' : 'text-ochre-text'
        }`}
      >
        {frenchTime(item.time)}
      </span>
      <span className="text-[15px] sm:order-none">
        {item.locationName ?? 'Lieu à fixer'}
        <span className="max-sm:hidden">
          <br />
        </span>
        <span className="sm:hidden">, </span>
        <strong>{DISCIPLINE_LABELS[item.tournament.discipline]}</strong>
      </span>
      <span className="text-[17px] leading-snug sm:text-[19px]">
        <span className={homeWon ? 'font-bold' : ''}>{item.home}</span> contre{' '}
        <span className={awayWon ? 'font-bold' : ''}>{item.away}</span>
      </span>
      <span className="text-[15px]">{status}</span>
    </Link>
  )
}

function ResultRow({ result }: { result: RecentResult }) {
  const { match, tournament } = result
  const winnerIsHome = match.winner_player_id === match.home_player_id
  return (
    <Link to={matchLink(result)} className="block border-b border-black py-3 text-black hover:bg-mist">
      <span className="flex items-center justify-between gap-3 text-[15px]">
        <span className="min-w-0 truncate">
          <span className={winnerIsHome ? 'font-bold' : ''}>{result.home}</span>
          <span className="px-1.5 tabular-nums">{result.score ? `${result.score.home}-${result.score.away}` : 'contre'}</span>
          <span className={!winnerIsHome ? 'font-bold' : ''}>{result.away}</span>
        </span>
        {result.forfeitName && <span className="shrink-0 text-[13px] font-semibold text-ochre-text">Forfait</span>}
      </span>
      <span className="block truncate text-[13px] text-muted">
        {tournament.name}, {result.roundLabel}
      </span>
    </Link>
  )
}
