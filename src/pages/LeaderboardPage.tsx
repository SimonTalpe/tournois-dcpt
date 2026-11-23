import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DemoModeNotice, Notice } from '../components/ui.tsx'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { loadEloHistory } from '../features/ranking/api.ts'
import { ELO_START } from '../features/ranking/elo.ts'
import {
  buildLeaderboard,
  RANK_CHANGE_DAYS,
  RANKED_MIN_GAMES,
  STREAK_MIN,
  type Leaderboard,
  type LeaderboardEntry,
} from '../features/ranking/leaderboard.ts'
import { RANKED_FORMAT_LABELS } from '../features/ranking/ranked.ts'
import { NewRankedMatchDialog, RankedMatchDialog } from '../features/ranking/RankedMatchDialog.tsx'
import { DISCIPLINE_ICONS, DISCIPLINE_LABELS, type Discipline } from '../features/tournaments/types.ts'
import { useLiveReload } from '../lib/useLiveReload.ts'

const DISCIPLINES: Discipline[] = ['mini_pong', 'darts']

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; board: Leaderboard }

/** Onglet « Classement » : leaderboard Elo par discipline, saisie d'un match classé. */
export function LeaderboardPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const discipline: Discipline = params.get('discipline') === 'darts' ? 'darts' : 'mini_pong'
  const matchId = params.get('match')
  const player = !auth.demoMode && isPlayer(auth) && Boolean(auth.profile)
  const viewer = { isAdmin: isAdmin(auth), profileId: auth.profile?.id ?? null, name: auth.profile?.full_name ?? '' }
  const [state, setState] = useState<State>({ status: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await loadEloHistory(discipline)
      setState({ status: 'ready', board: buildLeaderboard(rows) })
    } catch (e) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error', message: e instanceof Error ? e.message : String(e) }))
    }
  }, [discipline])

  useEffect(() => {
    if (auth.demoMode) return
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est modifié qu'après la réponse de Supabase
    void load()
  }, [load, auth.demoMode])
  useLiveReload(`leaderboard-${discipline}`, ['ranked_matches', 'matches'], () => void load(), !auth.demoMode)

  function setDiscipline(d: Discipline) {
    setState({ status: 'loading' })
    setParams({ discipline: d }, { replace: true })
  }
  const closeMatch = () => {
    const next = new URLSearchParams(params)
    next.delete('match')
    setParams(next, { replace: true })
  }

  if (auth.demoMode) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold text-court">🏅 Classement</h1>
        <DemoModeNotice />
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold text-court">🏅 Classement</h1>

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm" role="tablist" aria-label="Discipline">
        {DISCIPLINES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === discipline}
            onClick={() => setDiscipline(d)}
            className={`rounded-xl py-2.5 font-semibold transition ${d === discipline ? 'bg-court text-chalk' : 'text-court hover:bg-court/10'}`}
          >
            {DISCIPLINE_ICONS[d]} {DISCIPLINE_LABELS[d]}
          </button>
        ))}
      </div>

      {player && (
        <div className={`grid gap-2 ${discipline === 'darts' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-xl bg-court px-3 py-3 font-semibold text-chalk transition hover:bg-court-light active:scale-[0.98]"
          >
            ➕ Enregistrer un match classé
          </button>
          {discipline === 'darts' && (
            <button
              type="button"
              onClick={() => navigate('/compteur', { state: { rankedSetup: true } })}
              className="rounded-xl border-2 border-court bg-white px-3 py-3 font-semibold text-court transition hover:bg-court/10 active:scale-[0.98]"
            >
              🎯 Jouer au compteur
            </button>
          )}
        </div>
      )}

      {state.status === 'loading' && <p className="text-ink/60">Chargement du classement…</p>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'ready' && <Board board={state.board} linkPlayers={player} />}

      <details className="rounded-2xl bg-white p-4 text-sm text-ink/70 shadow-sm">
        <summary className="cursor-pointer font-semibold text-court">Comment ça marche ?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Chacun démarre à {ELO_START}. Après chaque match, le vainqueur prend des points au perdant : battre un joueur mieux
            classé rapporte plus, perdre contre un moins bien classé coûte plus.
          </li>
          <li>Les 10 premiers matchs comptent double (K = 40, puis 20) pour trouver vite son niveau.</li>
          <li>
            Comptent : les matchs de tournoi joués (pas les forfaits) et les matchs classés. Un adversaire sans compte compte pour{' '}
            {ELO_START}.
          </li>
          <li>Match classé : {RANKED_FORMAT_LABELS[discipline]}. 3 par jour au plus contre le même adversaire.</li>
          <li>
            Classé à partir de {RANKED_MIN_GAMES} matchs. ▲▼ : places gagnées ou perdues en {RANK_CHANGE_DAYS} jours. 🔥 :
            victoires d’affilée.
          </li>
        </ul>
      </details>

      {creating && (
        <NewRankedMatchDialog
          discipline={discipline}
          viewer={viewer}
          onClose={() => setCreating(false)}
          onSaved={() => void load()}
        />
      )}
      {matchId && player && (
        <RankedMatchDialog key={matchId} matchId={matchId} viewer={viewer} onClose={closeMatch} onSaved={() => void load()} />
      )}
    </section>
  )
}

export function Board({ board, linkPlayers }: { board: Leaderboard; linkPlayers: boolean }) {
  if (board.ranked.length === 0 && board.provisional.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-court/30 bg-white p-4 text-sm text-ink/70">
        Pas encore de match comptabilisé. Joue un match classé ou un match de tournoi pour entrer dans le classement !
      </div>
    )
  }
  return (
    <div className="space-y-5">
      {board.ranked.length > 0 && (
        <ol className="divide-y divide-ink/5 overflow-hidden rounded-2xl bg-white shadow-sm" aria-label="Classement Elo">
          {board.ranked.map((e) => (
            <Row key={e.playerId} entry={e} link={linkPlayers} />
          ))}
        </ol>
      )}
      {board.provisional.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-ink/60 uppercase">En cours de classement</h2>
          <ul className="divide-y divide-ink/5 overflow-hidden rounded-2xl bg-white shadow-sm">
            {board.provisional.map((e) => (
              <li key={e.playerId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <PlayerName entry={e} link={linkPlayers} />
                </span>
                <span className="text-xs text-ink/50">
                  {e.games}/{RANKED_MIN_GAMES} matchs · {e.wins} V – {e.losses} D
                </span>
                <span className="w-12 text-right font-semibold text-ink/60 tabular-nums">{e.rating}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function Row({ entry: e, link }: { entry: LeaderboardEntry; link: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-8 shrink-0 text-center">
        <span className="block text-lg leading-tight font-bold text-court tabular-nums">{MEDALS[e.rank as number] ?? e.rank}</span>
        <RankChange change={e.rankChange} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <PlayerName entry={e} link={link} />
        </span>
        <span className="block text-xs text-ink/60 tabular-nums">
          {e.wins} V – {e.losses} D · {e.winRate} %
          {e.streak >= STREAK_MIN && (
            <span className="ml-1.5 font-semibold text-clay" title={`${e.streak} victoires d’affilée`}>
              🔥 {e.streak}
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-lg leading-tight font-bold text-court tabular-nums">{e.rating}</span>
        <span className="block text-[10px] text-ink/50 uppercase">Elo</span>
      </span>
    </li>
  )
}

function RankChange({ change }: { change: number | null }) {
  if (change === null || change === 0) return null
  const up = change > 0
  return (
    <span
      className={`block text-[10px] font-semibold tabular-nums ${up ? 'text-court-light' : 'text-clay'}`}
      title={`${up ? '+' : '−'}${Math.abs(change)} place${Math.abs(change) > 1 ? 's' : ''} en ${RANK_CHANGE_DAYS} jours`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(change)}
    </span>
  )
}

function PlayerName({ entry, link }: { entry: LeaderboardEntry; link: boolean }) {
  if (!link) return <span className="font-medium">{entry.name}</span>
  return (
    <Link to={`/joueurs/${entry.playerId}`} className="font-medium hover:underline">
      {entry.name}
    </Link>
  )
}
