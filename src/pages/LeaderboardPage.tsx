import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DemoModeNotice, Icon, Notice, PageTitle } from '../components/ui.tsx'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { loadEloHistory } from '../features/ranking/api.ts'
import { ELO_START } from '../features/ranking/elo.ts'
import {
  buildLeaderboard,
  RANKED_MIN_GAMES,
  STREAK_MIN,
  type Leaderboard,
  type LeaderboardEntry,
} from '../features/ranking/leaderboard.ts'
import { RANKED_FORMAT_LABELS } from '../features/ranking/ranked.ts'
import { NewRankedMatchDialog, RankedMatchDialog } from '../features/ranking/RankedMatchDialog.tsx'
import { DISCIPLINE_LABELS, type Discipline } from '../features/tournaments/types.ts'
import { useLiveReload } from '../lib/useLiveReload.ts'

const DISCIPLINES: Discipline[] = ['mini_pong', 'darts']

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; board: Leaderboard; myPlayerId: string | null }

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
      const mine = auth.profile ? rows.find((r) => r.profile_id === auth.profile?.id) : undefined
      setState({ status: 'ready', board: buildLeaderboard(rows), myPlayerId: mine?.player_id ?? null })
    } catch (e) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error', message: e instanceof Error ? e.message : String(e) }))
    }
  }, [discipline, auth.profile])

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
        <PageTitle>Classement</PageTitle>
        <DemoModeNotice />
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <PageTitle>Classement</PageTitle>

      <div className="grid max-w-md grid-cols-2 border-2 border-black" role="tablist" aria-label="Discipline">
        {DISCIPLINES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === discipline}
            onClick={() => setDiscipline(d)}
            className={`min-h-12 text-base font-semibold ${d === discipline ? 'bg-black text-white' : 'bg-white text-black hover:bg-mist'}`}
          >
            {DISCIPLINE_LABELS[d]}
          </button>
        ))}
      </div>

      {player && (
        <div className={`grid max-w-md gap-2 ${discipline === 'darts' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[52px] border-2 border-black bg-black px-3 font-semibold text-white hover:border-ochre-text hover:bg-ochre-text"
          >
            Enregistrer un match classé
          </button>
          {discipline === 'darts' && (
            <button
              type="button"
              onClick={() => navigate('/compteur', { state: { rankedSetup: true } })}
              className="min-h-[52px] border-2 border-black bg-white px-3 font-semibold text-black hover:bg-black hover:text-white"
            >
              Jouer au compteur
            </button>
          )}
        </div>
      )}

      {state.status === 'loading' && <p className="text-muted">Chargement du classement…</p>}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'ready' && <Board board={state.board} linkPlayers={player} myPlayerId={state.myPlayerId} />}

      <details className="border-t-2 border-black pt-3 text-[15px] leading-relaxed">
        <summary className="flex min-h-11 cursor-pointer items-center text-lg font-bold">Comment ça marche ?</summary>
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
            Classé à partir de {RANKED_MIN_GAMES} matchs. La flamme indique une série d’au moins {STREAK_MIN} victoires
            d’affilée.
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

export function Board({
  board,
  linkPlayers,
  myPlayerId = null,
}: {
  board: Leaderboard
  linkPlayers: boolean
  myPlayerId?: string | null
}) {
  if (board.ranked.length === 0 && board.provisional.length === 0) {
    return (
      <p className="border-2 border-dashed border-black p-4 text-[15px]">
        Pas encore de match comptabilisé. Joue un match classé ou un match de tournoi pour entrer dans le classement.
      </p>
    )
  }
  const me = myPlayerId ? board.ranked.find((e) => e.playerId === myPlayerId) : undefined
  const ahead = me && me.rank !== null ? board.ranked.filter((e) => e.rating > me.rating).at(-1) : undefined
  const meProvisional = myPlayerId ? board.provisional.find((e) => e.playerId === myPlayerId) : undefined
  return (
    <div className="space-y-6">
      {me && (
        <section aria-label="Ta position" className="grid max-w-xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 bg-black p-4 text-white">
          <span className="row-span-2 font-display text-[72px] leading-[0.85] font-black">{me.rank}e</span>
          <span>
            <strong className="text-xl">{me.rating}</strong> <span className="text-sm">Elo</span>
          </span>
          <span className="text-sm">
            {me.wins} victoire{me.wins > 1 ? 's' : ''}, {me.losses} défaite{me.losses > 1 ? 's' : ''}, {me.winRate} %.
            {ahead ? ` ${ahead.rating - me.rating} points derrière ${ahead.name}.` : ' Tu es en tête.'}
          </span>
        </section>
      )}
      {!me && meProvisional && (
        <p className="max-w-xl border-l-4 border-black bg-mist p-3 text-[15px]">
          Encore {RANKED_MIN_GAMES - meProvisional.games} match{RANKED_MIN_GAMES - meProvisional.games > 1 ? 's' : ''} pour
          entrer au classement ({meProvisional.games} sur {RANKED_MIN_GAMES}).
        </p>
      )}
      {board.ranked.length > 0 && (
        <table className="w-full max-w-3xl border-collapse text-[15px]" aria-label="Classement Elo">
          <thead>
            <tr className="border-b-2 border-black text-right text-xs font-semibold">
              <th scope="col" className="w-8 py-2 text-left">
                #
              </th>
              <th scope="col" className="py-2 text-left">
                Joueur
              </th>
              <th scope="col" className="px-1 py-2">
                Elo
              </th>
              <th scope="col" className="px-1 py-2">
                <abbr title="Pourcentage de victoires">%</abbr>
              </th>
              <th scope="col" className="py-2 pl-1">
                <abbr title="Victoires et défaites">V–D</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {board.ranked.map((e) => (
              <Row key={e.playerId} entry={e} link={linkPlayers} mine={e.playerId === myPlayerId} />
            ))}
          </tbody>
        </table>
      )}
      {board.provisional.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-base font-bold">En cours de classement</h2>
          <p className="text-[15px] leading-normal">
            {board.provisional.map((e, i) => (
              <span key={e.playerId}>
                {i > 0 && ', '}
                <PlayerName entry={e} link={linkPlayers} /> ({e.games} sur {RANKED_MIN_GAMES})
              </span>
            ))}
          </p>
        </section>
      )}
    </div>
  )
}

function Row({ entry: e, link, mine }: { entry: LeaderboardEntry; link: boolean; mine: boolean }) {
  return (
    <tr className={`border-b border-black ${mine ? 'bg-ochre-tint font-bold' : ''}`}>
      <td className="py-3 text-left tabular-nums">{e.rank}</td>
      <td className="py-3 text-left">
        <PlayerName entry={e} link={link} />
        {e.streak >= STREAK_MIN && (
          <span
            className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[13px] font-bold text-ochre-text"
            title={`${e.streak} victoires d’affilée`}
          >
            <Icon name="flame" className="h-3.5 w-3.5" />
            {e.streak}
            <span className="sr-only"> victoires d’affilée</span>
          </span>
        )}
      </td>
      <td className="px-1 py-3 text-right font-bold tabular-nums">{e.rating}</td>
      <td className="px-1 py-3 text-right tabular-nums">{e.winRate} %</td>
      <td className="py-3 pl-1 text-right tabular-nums">
        {e.wins}–{e.losses}
      </td>
    </tr>
  )
}

function PlayerName({ entry, link }: { entry: LeaderboardEntry; link: boolean }) {
  if (!link) return <span>{entry.name}</span>
  return (
    <Link to={`/joueurs/${entry.playerId}`} className="text-black underline-offset-4 hover:underline">
      {entry.name}
    </Link>
  )
}
