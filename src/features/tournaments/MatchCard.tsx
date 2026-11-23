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
      return <div className="px-2.5 py-1.5 text-xs text-muted italic">Exempt</div>
    }
    return (
      <div
        className={`flex items-center justify-between gap-2 px-2.5 py-2 text-[15px] ${isMe ? 'bg-ochre text-white' : ''} ${
          isWinner ? 'font-bold' : ''
        }`}
      >
        {playerId ? (
          <span className="truncate" title={players.get(playerId)?.full_name}>
            {players.get(playerId)?.full_name ?? 'Joueur inconnu'}
          </span>
        ) : (
          <span className="truncate text-muted italic">
            {placeholderLabel(sources.get(`${match.id}:${slot}`), numbers)}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {slot === 'home' && !isBye && <span className={`text-[11px] ${isMe ? 'text-white' : 'text-muted'}`}>dom.</span>}
          {won && <span className="w-4 text-center tabular-nums">{won[slot]}</span>}
          {played && discipline === 'darts' && !won && isWinner && <span aria-label="vainqueur">✓</span>}
          {isWalkover && playerId && playerId === match.forfeit_player_id && (
            <span className="text-[11px] font-semibold">forfait</span>
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
      className={`block w-full overflow-hidden border-2 bg-white text-left ${
        isBye ? 'border-dashed border-black' : 'border-black'
      } ${clickable ? 'hover:bg-mist' : ''}`}
    >
      {number && (
        <div className="flex items-center justify-between bg-mist px-2.5 py-0.5 text-[11px] text-muted">
          <span>M{number}</span>
          {isBye && <span>Qualifié d'office</span>}
          {clickable && match.status === 'pending' && <span className="font-semibold text-black">À jouer</span>}
          {played && <span>Joué</span>}
          {isWalkover && <span className="font-semibold text-ochre-text">Forfait</span>}
        </div>
      )}
      <div className="divide-y divide-black">
        {row('home')}
        {row('away')}
      </div>
      {match.status === 'pending' && (match.scheduled_at || locationName) && (
        <div className="truncate border-t border-black bg-mist px-2.5 py-1 text-xs text-black">
          {match.scheduled_at && formatSchedule(match.scheduled_at)}
          {match.scheduled_at && locationName && ', '}
          {locationName}
        </div>
      )}
    </Tag>
  )
}
