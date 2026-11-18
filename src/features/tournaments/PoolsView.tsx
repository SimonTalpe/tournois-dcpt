import { useMemo, useState } from 'react'
import { SecondaryButton } from '../../components/ui.tsx'
import { formatSchedule } from '../../lib/schedule.ts'
import { setsWon } from '../../lib/scores.ts'
import { groupKey } from '../../lib/standings.ts'
import type { Viewer } from './MatchDialog.tsx'
import { poolStandings } from './standings.ts'
import { TiebreakDialog } from './TiebreakDialog.tsx'
import { gameFormatLabel, type Match, type Pool, type TournamentBundle } from './types.ts'

type Props = {
  bundle: TournamentBundle
  highlightPlayerId?: string | null
  onOpenMatch?: (matchId: string) => void
  viewer?: Viewer
  onSaved?: () => Promise<void>
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** Poules : classement, départages et matchs de chaque poule (touche un match pour voir ou saisir le résultat). */
export function PoolsView({ bundle, highlightPlayerId, onOpenMatch, viewer, onSaved }: Props) {
  const { pools, matches, players, rounds, tournament } = bundle
  const poolRound = rounds.find((r) => r.bracket === 'pool')
  const finalPhaseExists = rounds.some((r) => r.bracket !== 'pool')
  const qualifiers = tournament.qualifiers_per_pool ?? 0
  const isMiniPong = tournament.discipline === 'mini_pong'
  const standings = useMemo(() => poolStandings(bundle), [bundle])
  const [tiebreak, setTiebreak] = useState<{ pool: Pool; group: string[] } | null>(null)
  const name = (id: string | null) => (id ? (players.get(id)?.full_name ?? 'Joueur inconnu') : '—')

  /** Score au centre de la ligne : sets gagnés (mini-pong), ✓ du vainqueur (fléchettes), sinon « vs ». */
  const score = (m: Match) => {
    if (m.status === 'walkover') {
      return (
        <span className="text-[10px] font-semibold text-clay uppercase" title={`Forfait de ${name(m.forfeit_player_id)}`}>
          forfait
        </span>
      )
    }
    if (m.status === 'cancelled') return <span className="text-[10px] text-ink/40 uppercase">annulé</span>
    if (m.status !== 'played') return <span className="text-xs text-ink/40">vs</span>
    if (!isMiniPong) {
      return <span className="text-xs text-court">{m.winner_player_id === m.home_player_id ? '✓ –' : '– ✓'}</span>
    }
    const won = setsWon(bundle.sets.get(m.id) ?? [])
    return <span className="font-semibold text-court tabular-nums">{`${won.home}-${won.away}`}</span>
  }

  if (pools.length === 0) return <p className="text-sm text-ink/60">Les poules seront tirées au lancement du tournoi.</p>

  const canTiebreak = (group: string[]) =>
    Boolean(
      viewer &&
        tournament.status === 'in_progress' &&
        !finalPhaseExists &&
        (viewer.isAdmin || (!isMiniPong && viewer.isActivePlayer && viewer.playerId && group.includes(viewer.playerId))),
    )
  const existingFor = (poolId: string, group: string[]) =>
    bundle.tiebreaks.find((t) => t.pool_id === poolId && groupKey(t.player_ids) === groupKey(group)) ?? null

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink/60">
        {poolRound && <>Matchs de poule : {gameFormatLabel(tournament.discipline, poolRound)} · </>}
        {qualifiers} qualifié{qualifiers > 1 ? 's' : ''} par poule
        {isMiniPong
          ? ' · égalité : confrontation directe, puis différence de sets, puis de points'
          : ' · égalité : partie de départage à plusieurs'}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {standings.map(({ pool, result, tiebreaks }) => {
          const poolMatches = matches.filter((m) => m.pool_id === pool.id).sort((a, b) => a.position - b.position)
          const decided = result.complete && result.pendingTies.length === 0
          const played = poolMatches.filter((m) => ['played', 'walkover', 'cancelled'].includes(m.status)).length
          const applied = tiebreaks.filter((t) => t.player_ids.every((id) => result.rows.find((r) => r.playerId === id)?.byTiebreak))
          return (
            <section key={pool.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold text-court">Poule {pool.label}</h3>
                <span className="text-xs text-ink/50">
                  {result.complete ? 'Terminée' : `${played}/${poolMatches.length} matchs joués · provisoire`}
                </span>
              </div>

              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50">
                      <th className="px-1 py-1 font-medium">#</th>
                      <th className="px-1 py-1 font-medium">Joueur</th>
                      <th className="px-1 py-1 text-center font-medium" title="Matchs joués">
                        J
                      </th>
                      <th className="px-1 py-1 text-center font-medium" title="Victoires">
                        V
                      </th>
                      <th className="px-1 py-1 text-center font-medium" title="Défaites">
                        D
                      </th>
                      {isMiniPong && (
                        <>
                          <th className="px-1 py-1 text-center font-medium" title="Différence de sets">
                            Sets
                          </th>
                          <th className="px-1 py-1 text-center font-medium" title="Différence de points">
                            Pts
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => {
                      const qualified = decided && row.rank <= qualifiers
                      return (
                        <tr
                          key={row.playerId}
                          className={`border-t border-ink/10 ${row.playerId === highlightPlayerId ? 'bg-ball/40 font-semibold' : ''}`}
                        >
                          <td className="px-1 py-1.5 tabular-nums">{row.rank}</td>
                          <td className="max-w-0 px-1 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate">{name(row.playerId)}</span>
                              {qualified && (
                                <span className="shrink-0 rounded bg-court px-1 text-[10px] font-bold text-chalk" title="Qualifié">
                                  Q
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-1 py-1.5 text-center tabular-nums">{row.played}</td>
                          <td className="px-1 py-1.5 text-center font-semibold tabular-nums">{row.wins}</td>
                          <td className="px-1 py-1.5 text-center tabular-nums">{row.losses}</td>
                          {isMiniPong && (
                            <>
                              <td className="px-1 py-1.5 text-center tabular-nums">{signed(row.setsFor - row.setsAgainst)}</td>
                              <td className="px-1 py-1.5 text-center tabular-nums">
                                {signed(row.pointsFor - row.pointsAgainst)}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {result.pendingTies.map((group) => (
                <div key={groupKey(group)} className="space-y-2 rounded-xl bg-ball/30 p-3 text-sm">
                  <p>
                    ⚖️ Égalité entre {group.map(name).join(', ')} pour la qualification :{' '}
                    {isMiniPong ? "l'admin doit fixer le classement." : 'partie de départage à plusieurs à jouer.'}
                  </p>
                  {canTiebreak(group) && (
                    <SecondaryButton onClick={() => setTiebreak({ pool, group })}>Saisir le départage</SecondaryButton>
                  )}
                </div>
              ))}
              {applied.map((t) => (
                <p key={t.id} className="flex flex-wrap items-center gap-2 text-xs text-ink/60">
                  <span>
                    Départage {isMiniPong ? "fixé par l'admin" : 'par une partie à plusieurs'} :{' '}
                    {t.ranking.map((id, i) => `${i + 1}. ${name(id)}`).join(' · ')}
                  </span>
                  {viewer && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setTiebreak({ pool, group: [...t.player_ids] })}
                    >
                      détail
                    </button>
                  )}
                </p>
              ))}

              <div>
                <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink/50 uppercase">Matchs</h4>
                <ul className="divide-y divide-ink/10 text-sm">
                  {poolMatches.map((m) => {
                    const mine = highlightPlayerId && [m.home_player_id, m.away_player_id].includes(highlightPlayerId)
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          disabled={!onOpenMatch}
                          onClick={() => onOpenMatch?.(m.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition enabled:hover:bg-court/5 ${
                            mine ? 'font-semibold' : ''
                          }`}
                        >
                          <span
                            className={`min-w-0 flex-1 truncate text-right ${
                              ['played', 'walkover'].includes(m.status) && m.winner_player_id === m.home_player_id ? 'font-bold' : ''
                            }`}
                          >
                            {name(m.home_player_id)}
                          </span>
                          <span className="w-12 shrink-0 text-center">{score(m)}</span>
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              ['played', 'walkover'].includes(m.status) && m.winner_player_id === m.away_player_id ? 'font-bold' : ''
                            }`}
                          >
                            {name(m.away_player_id)}
                          </span>
                        </button>
                        {m.status === 'pending' && (m.scheduled_at || m.location_id) && (
                          <p className="pb-1 text-center text-[11px] text-ink/60">
                            {[
                              m.scheduled_at && formatSchedule(m.scheduled_at),
                              bundle.locations.find((l) => l.id === m.location_id)?.name,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )
        })}
      </div>
      {tiebreak && viewer && onSaved && (
        <TiebreakDialog
          key={groupKey(tiebreak.group)}
          bundle={bundle}
          pool={tiebreak.pool}
          group={tiebreak.group}
          existing={existingFor(tiebreak.pool.id, tiebreak.group)}
          viewer={canTiebreak(tiebreak.group) ? viewer : { ...viewer, isAdmin: false, isActivePlayer: false }}
          onClose={() => setTiebreak(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
