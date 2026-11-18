import { setsWon } from '../../lib/scores.ts'
import { gameFormatLabel, type Match, type TournamentBundle } from './types.ts'

type Props = {
  bundle: TournamentBundle
  highlightPlayerId?: string | null
  onOpenMatch?: (matchId: string) => void
}

/** Poules : joueurs et matchs de chaque poule (touche un match pour voir ou saisir le résultat). */
export function PoolsView({ bundle, highlightPlayerId, onOpenMatch }: Props) {
  const { pools, entries, matches, players, rounds, tournament } = bundle
  const poolRound = rounds.find((r) => r.bracket === 'pool')
  const name = (id: string | null) => (id ? (players.get(id)?.full_name ?? 'Joueur inconnu') : '—')

  /** Score au centre de la ligne : sets gagnés (mini-pong), ✓ du vainqueur (fléchettes), sinon « vs ». */
  const score = (m: Match) => {
    if (m.status !== 'played') return <span className="text-xs text-ink/40">vs</span>
    if (tournament.discipline === 'darts') {
      return <span className="text-xs text-court">{m.winner_player_id === m.home_player_id ? '✓ –' : '– ✓'}</span>
    }
    const won = setsWon(bundle.sets.get(m.id) ?? [])
    return <span className="font-semibold text-court tabular-nums">{`${won.home}-${won.away}`}</span>
  }

  if (pools.length === 0) return <p className="text-sm text-ink/60">Les poules seront tirées au lancement du tournoi.</p>

  return (
    <div className="space-y-3">
      {poolRound && (
        <p className="text-sm text-ink/60">Matchs de poule : {gameFormatLabel(tournament.discipline, poolRound)}</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {pools.map((pool) => {
          const poolPlayers = entries
            .filter((e) => e.pool_id === pool.id)
            .map((e) => e.player_id)
            .sort((a, b) => name(a).localeCompare(name(b), 'fr'))
          const poolMatches = matches.filter((m) => m.pool_id === pool.id).sort((a, b) => a.position - b.position)
          return (
            <section key={pool.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-lg font-bold text-court">Poule {pool.label}</h3>
              <ul className="space-y-1">
                {poolPlayers.map((id) => (
                  <li
                    key={id}
                    className={`rounded-lg px-2 py-1 text-sm ${id === highlightPlayerId ? 'bg-ball/40 font-semibold' : 'bg-chalk'}`}
                  >
                    {name(id)}
                  </li>
                ))}
              </ul>
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
                              m.status === 'played' && m.winner_player_id === m.home_player_id ? 'font-bold' : ''
                            }`}
                          >
                            {name(m.home_player_id)}
                          </span>
                          <span className="w-10 shrink-0 text-center">{score(m)}</span>
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              m.status === 'played' && m.winner_player_id === m.away_player_id ? 'font-bold' : ''
                            }`}
                          >
                            {name(m.away_player_id)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
