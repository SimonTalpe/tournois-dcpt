import { formatSchedule } from '../../lib/schedule.ts'
import { setsWon, type SetScore } from '../../lib/scores.ts'
import { dartLegsScore, placeholderLabel, type SlotSource } from './display.ts'
import type { Discipline, Match, Player } from './types.ts'

type Props = {
  match: Match
  players: Map<string, Player>
  numbers: Map<string, number>
  sources: Map<string, SlotSource>
  /** Participant à mettre en valeur (le joueur connecté). */
  highlightPlayerId?: string | null
  discipline: Discipline
  /** Scores des sets (mini-pong). */
  sets?: SetScore[]
  /** Ouvre le détail du match (saisie du résultat). */
  onOpen?: (matchId: string) => void
  /** Nom du lieu du match, s'il est fixé. */
  locationName?: string
}

/** Carte d'un match : deux lignes domicile / extérieur, ou attente « Vainqueur M3 ». */
export function MatchCard({
  match,
  players,
  numbers,
  sources,
  highlightPlayerId,
  discipline,
  sets,
  onOpen,
  locationName,
}: Props) {
  const number = numbers.get(match.id)
  const isBye = match.status === 'bye'
  const played = match.status === 'played'
  const isWalkover = match.status === 'walkover'
  const won = played && sets?.length ? setsWon(sets) : dartLegsScore(match)

  const row = (slot: 'home' | 'away') => {
    const playerId = slot === 'home' ? match.home_player_id : match.away_player_id
    const isMe = Boolean(playerId && playerId === highlightPlayerId)
    const isWinner = Boolean(playerId && playerId === match.winner_player_id && !isBye)
    if (isBye && slot === 'away') {
      return <div className="px-2.5 py-1.5 text-xs text-ink/40 italic">Exempt</div>
    }
    return (
      <div
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm ${isMe ? 'bg-ball/40' : ''} ${
          isWinner ? 'font-bold' : ''
        }`}
      >
        {playerId ? (
          <span className="truncate" title={players.get(playerId)?.full_name}>
            {players.get(playerId)?.full_name ?? 'Joueur inconnu'}
          </span>
        ) : (
          <span className="truncate text-ink/40 italic">
            {placeholderLabel(sources.get(`${match.id}:${slot}`), numbers)}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {slot === 'home' && !isBye && <span className="text-[10px] text-ink/40 uppercase">dom.</span>}
          {won && <span className="w-4 text-center tabular-nums">{won[slot]}</span>}
          {played && discipline === 'darts' && !won && isWinner && <span aria-label="vainqueur">✓</span>}
          {isWalkover && playerId && playerId === match.forfeit_player_id && (
            <span className="text-[10px] font-semibold text-clay uppercase">forfait</span>
          )}
        </span>
      </div>
    )
  }

  const clickable = Boolean(
    onOpen && !isBye && (played || isWalkover || match.home_player_id || match.away_player_id),
  )
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag
      {...(clickable ? { type: 'button' as const, onClick: () => onOpen?.(match.id) } : {})}
      className={`block w-full overflow-hidden rounded-lg border bg-white text-left shadow-sm ${
        isBye ? 'border-dashed border-ink/20' : 'border-ink/15'
      } ${clickable ? 'transition hover:border-court/50 hover:shadow' : ''}`}
    >
      {number && (
        <div className="flex items-center justify-between bg-court/5 px-2.5 py-0.5 text-[11px] text-ink/50">
          <span>M{number}</span>
          {isBye && <span>qualifié d'office</span>}
          {clickable && match.status === 'pending' && <span className="text-court">à jouer ›</span>}
          {played && <span>joué</span>}
          {isWalkover && <span className="text-clay">forfait</span>}
        </div>
      )}
      <div className="divide-y divide-ink/10">
        {row('home')}
        {row('away')}
      </div>
      {match.status === 'pending' && (match.scheduled_at || locationName) && (
        <div className="truncate border-t border-ink/10 bg-ball/20 px-2.5 py-0.5 text-[11px] text-ink/70">
          {match.scheduled_at && formatSchedule(match.scheduled_at)}
          {match.scheduled_at && locationName && ' · '}
          {locationName}
        </div>
      )}
    </Tag>
  )
}
