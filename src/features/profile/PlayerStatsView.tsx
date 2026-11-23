import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Notice } from '../../components/ui.tsx'
import { listPlayerRankedMatches, loadEloHistory, type RankedMatch } from '../ranking/api.ts'
import { EloChart } from '../ranking/EloChart.tsx'
import {
  buildLeaderboard,
  formatDelta,
  RANKED_MIN_GAMES,
  ratingSeries,
  STREAK_MIN,
  type EloHistoryRow,
  type LeaderboardEntry,
} from '../ranking/leaderboard.ts'
import { rankedScoreLabel } from '../ranking/ranked.ts'
import { DISCIPLINE_LABELS, STATUS_LABELS, type Discipline } from '../tournaments/types.ts'
import { loadPlayerHistory } from './api.ts'
import { disciplineStats, playerHistory, type HistoryMatch, type TournamentHistory } from './stats.ts'

type EloChange = { delta: number; after: number }

type EloCard = {
  discipline: Discipline
  rows: EloHistoryRow[]
  /** Place dans le leaderboard (null si en cours de classement ou compte inactif). */
  entry: LeaderboardEntry | null
  rankedCount: number
}

type Ready = {
  status: 'ready'
  history: TournamentHistory[]
  elo: EloCard[]
  /** Écart d'Elo du joueur et Elo après le match, par match (tournoi ou classé). */
  deltas: Map<string, EloChange>
  ranked: RankedMatch[]
}
type State = { status: 'loading' } | { status: 'error'; message: string } | Ready

const DISCIPLINES: Discipline[] = ['mini_pong', 'darts']
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

async function loadAll(playerId: string): Promise<Ready> {
  const [data, ranked, ...boards] = await Promise.all([
    loadPlayerHistory(playerId),
    listPlayerRankedMatches(playerId),
    ...DISCIPLINES.map((d) => loadEloHistory(d)),
  ])
  const deltas = new Map<string, EloChange>()
  const elo: EloCard[] = []
  DISCIPLINES.forEach((discipline, i) => {
    const all = boards[i]
    const rows = all.filter((r) => r.player_id === playerId)
    for (const r of rows) deltas.set(r.match_id, { delta: r.delta, after: r.rating_after })
    if (rows.length === 0) return
    const board = buildLeaderboard(all)
    elo.push({
      discipline,
      rows,
      entry: [...board.ranked, ...board.provisional].find((e) => e.playerId === playerId) ?? null,
      rankedCount: board.ranked.length,
    })
  })
  return { status: 'ready', history: data ? playerHistory(data) : [], elo, deltas, ranked }
}

/** Elo, statistiques par discipline, matchs classés et historique des tournois d'un participant. */
export function PlayerStatsView({ playerId }: { playerId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadAll(playerId)
      .then((ready) => {
        if (!cancelled) setState(ready)
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  if (state.status === 'loading') return <p className="text-muted">Chargement de l’historique…</p>
  if (state.status === 'error') return <Notice tone="error">{state.message}</Notice>
  const { history, elo, deltas, ranked } = state
  if (history.length === 0 && elo.length === 0 && ranked.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black bg-white p-4 text-sm text-muted">
        Pas encore de match joué.
      </div>
    )
  }
  const stats = disciplineStats(history)

  return (
    <div className="space-y-6">
      {elo.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[30px] leading-none font-extrabold">Elo</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {elo.map((card) => (
              <EloCardView key={card.discipline} card={card} />
            ))}
          </div>
        </section>
      )}

      {stats.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[30px] leading-none font-extrabold">Statistiques en tournoi</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {stats.map((s) => (
              <article key={s.discipline} className="space-y-3 border-2 border-black p-4">
                <h3 className="flex items-center gap-2 text-base font-bold">
                  
                  {DISCIPLINE_LABELS[s.discipline]}
                  <span className="text-xs font-normal text-muted">
                    {s.tournaments} tournoi{s.tournaments > 1 ? 's' : ''}
                  </span>
                </h3>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Matchs" value={String(s.played)} />
                  <Stat label="V / D" value={`${s.wins} / ${s.losses}`} />
                  <Stat label="Victoires" value={s.winRate === null ? '—' : `${s.winRate} %`} />
                </dl>
                {s.played > 0 && (
                  <div className="h-2 overflow-hidden bg-mist" aria-hidden="true">
                    <div className="h-full bg-ochre" style={{ width: `${s.winRate ?? 0}%` }} />
                  </div>
                )}
                <ul className="space-y-0.5 text-sm text-muted">
                  <li>
                    Meilleur parcours :{' '}
                    {s.best ? (
                      <>
                        <span className="font-semibold text-ink">{s.best.finish.label}</span>
                        <span className="text-muted"> ({s.best.tournament.name})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </li>
                  {s.discipline === 'mini_pong' && s.setsFor + s.setsAgainst > 0 && (
                    <li>
                      Sets : {s.setsFor} gagnés · {s.setsAgainst} perdus
                    </li>
                  )}
                  {s.walkovers > 0 && <li>Forfaits (non comptés) : {s.walkovers}</li>}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {ranked.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[30px] leading-none font-extrabold">Matchs classés</h2>
          <ul className="divide-y divide-black overflow-hidden rounded-2xl bg-white border-2 border-black">
            {ranked.map((m) => (
              <li key={m.id}>
                <RankedLine match={m} playerId={playerId} change={deltas.get(m.id) ?? null} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[30px] leading-none font-extrabold">Historique des tournois</h2>
          <ul className="space-y-3">
            {history.map((h) => (
              <li key={h.tournament.id} className="overflow-hidden rounded-2xl bg-white border-2 border-black">
                <Link
                  to={`/tournois/${h.tournament.id}`}
                  className="flex items-center justify-between gap-3 bg-mist px-4 py-2.5 hover:bg-mist"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-court">
                      {h.tournament.name}
                    </span>
                    <span className="block text-xs text-muted">{STATUS_LABELS[h.tournament.status]}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-semibold">{h.finish.label}</span>
                </Link>
                {h.matches.filter((m) => m.outcome !== 'bye').length > 0 && (
                  <ul className="divide-y divide-black">
                    {h.matches
                      .filter((m) => m.outcome !== 'bye')
                      .map((m) => (
                        <li key={m.match.id}>
                          <MatchLine item={m} tournamentId={h.tournament.id} eloChange={deltas.get(m.match.id) ?? null} />
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function EloCardView({ card }: { card: EloCard }) {
  const { discipline, rows, entry } = card
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const last = sorted[sorted.length - 1]
  const wins = sorted.filter((r) => r.won).length
  const series = ratingSeries(sorted)
  const points = series.map((rating, i) => ({
    rating,
    label: i === 0 ? 'Départ' : `Match ${i} · ${sorted[i - 1].won ? 'V' : 'D'} contre ${sorted[i - 1].opponent_name}`,
    delta: i === 0 ? null : sorted[i - 1].delta,
  }))
  const streak = entry?.streak ?? 0
  return (
    <article className="space-y-3 border-2 border-black p-4">
      <h3 className="flex items-center justify-between gap-2 text-base font-bold">
        <span>
          {DISCIPLINE_LABELS[discipline]}
        </span>
        <Link to={`/classement?discipline=${discipline}`} className="text-xs font-normal text-ochre-text underline">
          {entry?.rank ? `${entry.rank}${entry.rank === 1 ? 'er' : 'e'} / ${card.rankedCount}` : 'Classement'}
        </Link>
      </h3>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Elo" value={String(last.rating_after)} big />
        <Stat label="V / D" value={`${wins} / ${sorted.length - wins}`} />
        <Stat label="Victoires" value={`${Math.round((wins / sorted.length) * 100)} %`} />
      </dl>
      {sorted.length < RANKED_MIN_GAMES && (
        <p className="text-xs text-muted">
          En cours de classement : {sorted.length}/{RANKED_MIN_GAMES} matchs.
        </p>
      )}
      {streak >= STREAK_MIN && <p className="text-sm font-semibold text-ochre-text">{streak} victoires d’affilée</p>}
      <EloChart points={points} title="Évolution de l’Elo" />
    </article>
  )
}

/** Écart d'Elo du match et Elo après le match. */
function DeltaBadge({ change }: { change: EloChange | null }) {
  if (change === null) return null
  return (
    <span className="shrink-0 text-right text-xs leading-tight tabular-nums" title="Écart d’Elo · Elo après le match">
      <span className={`block font-semibold ${change.delta >= 0 ? 'text-court' : 'text-clay'}`}>{formatDelta(change.delta)}</span>
      <span className="block text-[10px] text-muted">{change.after}</span>
    </span>
  )
}

function RankedLine({ match, playerId, change }: { match: RankedMatch; playerId: string; change: EloChange | null }) {
  const won = match.winner_player_id === playerId
  const opponent = match.home_player_id === playerId ? match.away : match.home
  const score = rankedScoreLabel(match, playerId)
  return (
    <Link
      to={`/classement?discipline=${match.discipline}&match=${match.id}`}
      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-mist"
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          won ? 'bg-court text-chalk' : 'bg-clay text-white'
        }`}
      >
        {won ? 'V' : 'D'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="text-muted">contre </span>
          {opponent?.full_name ?? 'Joueur'}
        </span>
        <span className="block truncate text-xs text-muted">
          Match classé · {dateFormat.format(new Date(match.played_at))}
          {match.dart_game_id ? ' · au compteur' : ''}
        </span>
      </span>
      {score && <span className="shrink-0 text-xs text-muted tabular-nums">{score}</span>}
      <DeltaBadge change={change} />
    </Link>
  )
}

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="border-l border-black px-2 py-1 first:border-l-0">
      <dd className={`font-display leading-none font-black tabular-nums ${big ? 'text-[44px]' : 'text-[32px]'}`}>{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}

const OUTCOME: Record<HistoryMatch['outcome'], { label: string; className: string }> = {
  win: { label: 'V', className: 'bg-court text-chalk' },
  loss: { label: 'D', className: 'bg-clay text-white' },
  walkover_win: { label: 'V', className: 'bg-muted text-white' },
  walkover_loss: { label: 'D', className: 'border-2 border-ochre-text text-ochre-text' },
  pending: { label: '…', className: 'bg-mist text-muted' },
  bye: { label: '–', className: 'bg-mist text-muted' },
  cancelled: { label: '×', className: 'bg-mist text-muted' },
}

function MatchLine({ item, tournamentId, eloChange }: { item: HistoryMatch; tournamentId: string; eloChange: EloChange | null }) {
  const badge = OUTCOME[item.outcome]
  const detail =
    item.outcome === 'walkover_win'
      ? 'gagné par forfait'
      : item.outcome === 'walkover_loss'
        ? 'forfait'
        : item.outcome === 'cancelled'
          ? 'annulé'
          : item.outcome === 'pending'
            ? 'à jouer'
            : item.score
              ? `${item.score.mine} – ${item.score.theirs}`
              : null
  return (
    <Link
      to={`/tournois/${tournamentId}?match=${item.match.id}`}
      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-mist"
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge.className}`}>
        {badge.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="text-muted">contre </span>
          {item.opponent ?? <span className="text-muted italic">à déterminer</span>}
        </span>
        <span className="block truncate text-xs text-muted">{item.roundLabel}</span>
      </span>
      {detail && <span className="shrink-0 text-xs text-muted tabular-nums">{detail}</span>}
      <DeltaBadge change={eloChange} />
    </Link>
  )
}
