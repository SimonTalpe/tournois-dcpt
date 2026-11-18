import { gameFormatLabel, type TournamentBundle } from './types.ts'

type Props = { bundle: TournamentBundle; highlightPlayerId?: string | null }

/** Poules : joueurs et matchs de chaque poule (le classement arrive avec la saisie des scores). */
export function PoolsView({ bundle, highlightPlayerId }: Props) {
  const { pools, entries, matches, players, rounds, tournament } = bundle
  const poolRound = rounds.find((r) => r.bracket === 'pool')
  const name = (id: string | null) => (id ? (players.get(id)?.full_name ?? 'Joueur inconnu') : '—')

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
                      <li key={m.id} className={`flex items-center gap-2 py-1.5 ${mine ? 'font-semibold' : ''}`}>
                        <span className="min-w-0 flex-1 truncate text-right">{name(m.home_player_id)}</span>
                        <span className="shrink-0 text-xs text-ink/40">vs</span>
                        <span className="min-w-0 flex-1 truncate">{name(m.away_player_id)}</span>
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
