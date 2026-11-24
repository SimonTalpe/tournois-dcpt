import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { DemoModeNotice, Icon, Notice } from '../components/ui.tsx'
import { RichText } from '../features/content/RichText.tsx'
import { isAdmin, useAuth } from '../features/auth/AuthContext.ts'
import { loadTournament } from '../features/tournaments/api.ts'
import { BracketView } from '../features/tournaments/BracketView.tsx'
import { PoolsView } from '../features/tournaments/PoolsView.tsx'
import { MatchDialog, type Viewer } from '../features/tournaments/MatchDialog.tsx'
import { useLiveTournament, type LiveContext } from '../features/tournaments/useLiveTournament.ts'
import { TournamentAdmin } from '../features/tournaments/TournamentAdmin.tsx'
import {
  DISCIPLINE_LABELS,
  FORMAT_LABELS,
  STATUS_LABELS,
  type TournamentBundle,
} from '../features/tournaments/types.ts'

type Tab = 'tableau' | 'poules' | 'consolante' | 'joueurs' | 'gestion'

export function TournamentPage() {
  const { tournamentId = '' } = useParams()
  const auth = useAuth()
  const admin = isAdmin(auth)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [bundle, setBundle] = useState<TournamentBundle | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // Lien direct vers un match (depuis l'accueil) : ?match=<id> ouvre son détail.
  const [openMatchId, setOpenMatchId] = useState<string | null>(() => searchParams.get('match'))

  const reload = useCallback(async () => {
    try {
      setBundle(await loadTournament(tournamentId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tournamentId])

  useEffect(() => {
    if (auth.demoMode) return
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void reload()
  }, [reload, auth.demoMode])

  // Temps réel : rechargement discret (une erreur passagère ne remplace pas la page affichée).
  const [refreshFailed, setRefreshFailed] = useState(false)
  const refresh = useCallback(async () => {
    try {
      setBundle(await loadTournament(tournamentId))
      setRefreshFailed(false)
    } catch {
      setRefreshFailed(true)
    }
  }, [tournamentId])
  const liveContext = useMemo<LiveContext | null>(
    () =>
      bundle && !auth.demoMode
        ? {
            tournamentId: bundle.tournament.id,
            poolIds: new Set(bundle.pools.map((p) => p.id)),
            roundIds: new Set(bundle.rounds.map((r) => r.id)),
          }
        : null,
    [bundle, auth.demoMode],
  )
  const live = useLiveTournament(liveContext, () => void refresh())

  if (auth.demoMode) return <DemoModeNotice />
  if (error) return <Notice tone="error">{error}</Notice>
  if (bundle === undefined) return <p className="text-muted">Chargement…</p>
  if (bundle === null) {
    return (
      <section className="space-y-3">
        <Notice>Ce tournoi n'existe pas (ou plus).</Notice>
        <Link to="/tournois" className="text-sm underline">
          ← Tous les tournois
        </Link>
      </section>
    )
  }

  const { tournament, rounds, entries, players, pools } = bundle
  const hasPools = tournament.format === 'pools_knockout'
  const hasMain = rounds.some((r) => r.bracket === 'main')
  const hasConsolation = rounds.some((r) => r.bracket === 'consolation')
  const myPlayerId = [...players.values()].find((p) => p.profile_id && p.profile_id === auth.profile?.id)?.id ?? null

  const viewer: Viewer = {
    isAdmin: admin,
    isActivePlayer: auth.access === 'player' || auth.access === 'admin',
    profileId: auth.profile?.id ?? null,
    playerId: myPlayerId,
  }
  const openMatch = bundle.matches.find((m) => m.id === openMatchId)

  const tabs: { id: Tab; label: string }[] = [
    ...(tournament.status !== 'draft'
      ? [
          ...(hasPools ? [{ id: 'poules' as const, label: 'Poules' }] : []),
          { id: 'tableau' as const, label: hasPools ? 'Phase finale' : 'Tableau' },
          ...(hasConsolation ? [{ id: 'consolante' as const, label: 'Consolante' }] : []),
          { id: 'joueurs' as const, label: `Joueurs (${entries.length})` },
        ]
      : []),
    ...(admin ? [{ id: 'gestion' as const, label: 'Gestion' }] : []),
  ]
  const requested = searchParams.get('onglet') as Tab | null
  const tab: Tab = tabs.find((t) => t.id === requested)?.id ?? tabs[0]?.id ?? 'joueurs'
  const poolOf = new Map(pools.map((p) => [p.id, p.label]))
  const name = (id: string) => players.get(id)?.full_name ?? 'Joueur inconnu'

  return (
    <section className="space-y-4">
      <header
        className={`-mx-4 -mt-6 space-y-2 px-4 pt-5 pb-6 text-white sm:-mx-6 sm:px-6 ${
          tournament.discipline === 'mini_pong' ? 'bg-black' : 'bg-ochre'
        }`}
      >
        <Link to="/tournois" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-white">
          <Icon name="back" className="h-[18px] w-[18px]" />
          Tous les tournois
        </Link>
        <p className="text-[15px] font-semibold">
          {DISCIPLINE_LABELS[tournament.discipline]}, {entries.length} joueurs
        </p>
        <h1 className="font-display text-[46px] leading-[0.88] font-black sm:text-[72px] lg:text-[96px]">{tournament.name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
          <span>
            {FORMAT_LABELS[tournament.format]}, {STATUS_LABELS[tournament.status].toLowerCase()}
          </span>
          {live === 'live' && !refreshFailed ? (
            <span className="inline-flex items-center gap-1.5 text-sm" title="Scores et tableaux mis à jour automatiquement">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
              En direct
            </span>
          ) : live === 'connecting' && !refreshFailed ? null : (
            <button type="button" onClick={() => void refresh()} className="min-h-11 text-sm font-semibold underline">
              Mise à jour automatique interrompue, rafraîchir
            </button>
          )}
        </p>
      </header>
      {tournament.description && <RichText html={tournament.description} />}

      {tabs.length > 1 && (
        <nav className="-mx-4 flex overflow-x-auto border-b-2 border-black px-4 sm:-mx-6 sm:px-6" aria-label="Sections du tournoi">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setSearchParams({ onglet: t.id }, { replace: true })}
              className={`min-h-12 shrink-0 px-4 text-base font-semibold ${
                tab === t.id ? 'shadow-[inset_0_-5px_0_var(--color-ochre)]' : 'hover:bg-mist'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {tournament.status === 'draft' && (
        <Notice>
          Brouillon : invisible pour les joueurs et les spectateurs. Inscris les joueurs puis lance le tournoi pour faire
          le tirage au sort.
        </Notice>
      )}

      {tab === 'tableau' &&
        (hasMain ? (
          <BracketView bundle={bundle} bracket="main" highlightPlayerId={myPlayerId} onOpenMatch={setOpenMatchId} />
        ) : (
          <p className="border-2 border-dashed border-black p-4 text-[15px]">
            La phase finale sera construite à la fin des poules : {tournament.qualifiers_per_pool} qualifié(s) par
            poule, soit {(tournament.qualifiers_per_pool ?? 0) * (tournament.pool_count ?? 0)} joueurs, placés par{' '}
            {tournament.qualifier_placement === 'classic' ? 'croisement classique' : 'tirage au sort'}.
          </p>
        ))}
      {tab === 'poules' && (
        <PoolsView
          bundle={bundle}
          highlightPlayerId={myPlayerId}
          onOpenMatch={setOpenMatchId}
          viewer={viewer}
          onSaved={reload}
        />
      )}
      {tab === 'consolante' && (
        <BracketView bundle={bundle} bracket="consolation" highlightPlayerId={myPlayerId} onOpenMatch={setOpenMatchId} />
      )}
      {openMatch && (
        <MatchDialog
          key={openMatch.id}
          bundle={bundle}
          match={openMatch}
          viewer={viewer}
          onClose={() => {
            setOpenMatchId(null)
            if (searchParams.has('match')) {
              const next = new URLSearchParams(searchParams)
              next.delete('match')
              setSearchParams(next, { replace: true })
            }
          }}
          onSaved={reload}
        />
      )}
      {tab === 'joueurs' && (
        <ul className="grid border-t-2 border-black sm:grid-cols-2 sm:gap-x-8">
          {[...entries]
            .sort((a, b) => name(a.player_id).localeCompare(name(b.player_id), 'fr'))
            .map((e) => (
              <li
                key={e.player_id}
                className={`flex min-h-12 items-center justify-between border-b border-black px-3 py-2 ${
                  e.player_id === myPlayerId ? 'bg-ochre-tint font-bold' : ''
                }`}
              >
                {viewer.isActivePlayer ? (
                  <Link to={`/joueurs/${e.player_id}`} className="truncate text-black underline-offset-4 hover:underline">
                    {name(e.player_id)}
                  </Link>
                ) : (
                  <span className="truncate">{name(e.player_id)}</span>
                )}
                {e.pool_id && <span className="text-xs text-muted">Poule {poolOf.get(e.pool_id)}</span>}
              </li>
            ))}
        </ul>
      )}
      {tab === 'gestion' && admin && (
        <TournamentAdmin bundle={bundle} reload={reload} onDeleted={() => navigate('/tournois', { replace: true })} />
      )}
    </section>
  )
}
