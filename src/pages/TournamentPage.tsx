import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { DemoModeNotice, Notice } from '../components/ui.tsx'
import { RichText } from '../features/content/RichText.tsx'
import { isAdmin, useAuth } from '../features/auth/AuthContext.ts'
import { loadTournament } from '../features/tournaments/api.ts'
import { BracketView } from '../features/tournaments/BracketView.tsx'
import { PoolsView } from '../features/tournaments/PoolsView.tsx'
import { MatchDialog, type Viewer } from '../features/tournaments/MatchDialog.tsx'
import { useLiveTournament, type LiveContext } from '../features/tournaments/useLiveTournament.ts'
import { TournamentAdmin } from '../features/tournaments/TournamentAdmin.tsx'
import {
  DISCIPLINE_ICONS,
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
  if (bundle === undefined) return <p className="text-ink/60">Chargement…</p>
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
    ...(admin ? [{ id: 'gestion' as const, label: '⚙️ Gestion' }] : []),
  ]
  const requested = searchParams.get('onglet') as Tab | null
  const tab: Tab = tabs.find((t) => t.id === requested)?.id ?? tabs[0]?.id ?? 'joueurs'
  const poolOf = new Map(pools.map((p) => [p.id, p.label]))
  const name = (id: string) => players.get(id)?.full_name ?? 'Joueur inconnu'

  return (
    <section className="space-y-4">
      <Link to="/tournois" className="text-sm text-ink/60 underline">
        ← Tous les tournois
      </Link>
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-court">
          <span aria-hidden="true">{DISCIPLINE_ICONS[tournament.discipline]}</span>
          {tournament.name}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink/60">
          <span>
            {DISCIPLINE_LABELS[tournament.discipline]} · {FORMAT_LABELS[tournament.format]} ·{' '}
            <span className="font-semibold">{STATUS_LABELS[tournament.status]}</span>
          </span>
          {live === 'live' && !refreshFailed ? (
            <span className="inline-flex items-center gap-1 text-xs text-court" title="Scores et tableaux mis à jour automatiquement">
              <span className="h-2 w-2 animate-pulse rounded-full bg-court" aria-hidden="true" />
              En direct
            </span>
          ) : live === 'connecting' && !refreshFailed ? null : (
            <button type="button" onClick={() => void refresh()} className="text-xs text-clay underline">
              Mise à jour automatique interrompue — rafraîchir
            </button>
          )}
        </p>
        <RichText html={tournament.description} className="pt-2" />
      </header>

      {tabs.length > 1 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Sections du tournoi">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSearchParams({ onglet: t.id }, { replace: true })}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                tab === t.id ? 'bg-court text-chalk' : 'bg-white text-court shadow-sm hover:bg-court/10'
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
          <p className="rounded-2xl bg-white p-4 text-sm text-ink/70 shadow-sm">
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
        <ul className="grid gap-2 sm:grid-cols-2">
          {[...entries]
            .sort((a, b) => name(a.player_id).localeCompare(name(b.player_id), 'fr'))
            .map((e) => (
              <li
                key={e.player_id}
                className={`flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm ${
                  e.player_id === myPlayerId ? 'ring-2 ring-ball' : ''
                }`}
              >
                <span className="truncate">{name(e.player_id)}</span>
                {e.pool_id && <span className="text-xs text-ink/50">Poule {poolOf.get(e.pool_id)}</span>}
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
