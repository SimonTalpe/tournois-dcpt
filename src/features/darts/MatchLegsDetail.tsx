import { useEffect, useState } from 'react'
import { listMatchLegs, type LegDetail } from './api.ts'
import { summarizeLegs } from './match.ts'

type Props = {
  matchId: string
  /** Change à chaque nouveau résultat : la liste est relue. */
  resultAt: string | null
  playerIds: [string, string]
  name: (playerId: string) => string
}

/** Détail d'un match joué au compteur : restes par manche, fléchettes et moyenne de chaque joueur. */
export function MatchLegsDetail({ matchId, resultAt, playerIds, name }: Props) {
  const [legs, setLegs] = useState<LegDetail[] | null>(null)

  useEffect(() => {
    let alive = true
    listMatchLegs(matchId)
      .then((list) => alive && setLegs(list))
      .catch(() => alive && setLegs([]))
    return () => {
      alive = false
    }
  }, [matchId, resultAt])

  if (!legs || legs.length === 0) return null
  const { lines, totals } = summarizeLegs(legs)
  return (
    <div className="space-y-2 rounded-xl bg-chalk p-3 text-sm">
      <p className="text-xs font-semibold text-muted">Joué au compteur</p>
      {lines.length > 1 && (
        <ol className="space-y-0.5">
          {lines.map((line) => {
            const loser = playerIds.find((id) => id !== line.winner)
            return (
              <li key={line.number} className="flex justify-between gap-2">
                <span className="text-muted">Manche {line.number}</span>
                <span className="truncate">
                  {line.winner ? name(line.winner) : '?'}
                  {loser && <span className="text-muted"> · {name(loser)} reste {line.remaining.get(loser)}</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {lines.length === 1 && (
        <p>
          {playerIds
            .filter((id) => id !== lines[0].winner)
            .map((id) => `${name(id)} reste ${lines[0].remaining.get(id)}`)
            .join(' · ')}
        </p>
      )}
      <ul className="space-y-0.5 border-t border-black pt-2">
        {playerIds.map((id) => {
          const t = totals.find((x) => x.playerId === id)
          return (
            <li key={id} className="flex justify-between gap-2">
              <span className="truncate">{name(id)}</span>
              <span className="shrink-0 text-muted tabular-nums">
                {t?.darts ?? 0} fléchettes{t?.average != null && ` · moy. ${t.average}`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
