import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Notice } from '../../components/ui.tsx'
import { DISCIPLINE_ICONS, DISCIPLINE_LABELS, STATUS_LABELS } from '../tournaments/types.ts'
import { loadPlayerHistory } from './api.ts'
import { disciplineStats, playerHistory, type HistoryMatch, type TournamentHistory } from './stats.ts'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; history: TournamentHistory[] }

/** Statistiques par discipline et historique des tournois d'un participant. */
export function PlayerStatsView({ playerId }: { playerId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadPlayerHistory(playerId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', history: data ? playerHistory(data) : [] })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  if (state.status === 'loading') return <p className="text-ink/60">Chargement de l’historique…</p>
  if (state.status === 'error') return <Notice tone="error">{state.message}</Notice>
  const { history } = state
  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-court/30 bg-white p-4 text-sm text-ink/70">
        Pas encore de tournoi joué.
      </div>
    )
  }
  const stats = disciplineStats(history)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink/60 uppercase">Statistiques</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {stats.map((s) => (
            <article key={s.discipline} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 font-bold text-court">
                <span aria-hidden="true">{DISCIPLINE_ICONS[s.discipline]}</span>
                {DISCIPLINE_LABELS[s.discipline]}
                <span className="text-xs font-normal text-ink/50">
                  · {s.tournaments} tournoi{s.tournaments > 1 ? 's' : ''}
                </span>
              </h3>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Matchs" value={String(s.played)} />
                <Stat label="V / D" value={`${s.wins} / ${s.losses}`} />
                <Stat label="Victoires" value={s.winRate === null ? '—' : `${s.winRate} %`} />
              </dl>
              {s.played > 0 && (
                <div className="h-2 overflow-hidden rounded-full bg-clay/30" aria-hidden="true">
                  <div className="h-full rounded-full bg-court" style={{ width: `${s.winRate ?? 0}%` }} />
                </div>
              )}
              <ul className="space-y-0.5 text-sm text-ink/70">
                <li>
                  Meilleur parcours :{' '}
                  {s.best ? (
                    <>
                      <span className="font-semibold text-ink">{s.best.finish.label}</span>
                      <span className="text-ink/50"> ({s.best.tournament.name})</span>
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink/60 uppercase">Historique</h2>
        <ul className="space-y-3">
          {history.map((h) => (
            <li key={h.tournament.id} className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <Link
                to={`/tournois/${h.tournament.id}`}
                className="flex items-center justify-between gap-3 bg-court/5 px-4 py-2.5 hover:bg-court/10"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-court">
                    {DISCIPLINE_ICONS[h.tournament.discipline]} {h.tournament.name}
                  </span>
                  <span className="block text-xs text-ink/50">{STATUS_LABELS[h.tournament.status]}</span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold">{h.finish.label}</span>
              </Link>
              {h.matches.filter((m) => m.outcome !== 'bye').length > 0 && (
                <ul className="divide-y divide-ink/5">
                  {h.matches
                    .filter((m) => m.outcome !== 'bye')
                    .map((m) => (
                      <li key={m.match.id}>
                        <MatchLine item={m} tournamentId={h.tournament.id} />
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-chalk px-2 py-2">
      <dd className="text-lg font-bold text-court tabular-nums">{value}</dd>
      <dt className="text-xs text-ink/60">{label}</dt>
    </div>
  )
}

const OUTCOME: Record<HistoryMatch['outcome'], { label: string; className: string }> = {
  win: { label: 'V', className: 'bg-court text-chalk' },
  loss: { label: 'D', className: 'bg-clay text-white' },
  walkover_win: { label: 'V', className: 'bg-court/60 text-chalk' },
  walkover_loss: { label: 'D', className: 'bg-clay/60 text-white' },
  pending: { label: '…', className: 'bg-ink/10 text-ink/60' },
  bye: { label: '–', className: 'bg-ink/10 text-ink/60' },
  cancelled: { label: '×', className: 'bg-ink/10 text-ink/60' },
}

function MatchLine({ item, tournamentId }: { item: HistoryMatch; tournamentId: string }) {
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
    <Link to={`/tournois/${tournamentId}?match=${item.match.id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-chalk">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge.className}`}>
        {badge.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="text-ink/50">contre </span>
          {item.opponent ?? <span className="text-ink/50 italic">à déterminer</span>}
        </span>
        <span className="block truncate text-xs text-ink/50">{item.roundLabel}</span>
      </span>
      {detail && <span className="shrink-0 text-xs text-ink/60 tabular-nums">{detail}</span>}
    </Link>
  )
}
