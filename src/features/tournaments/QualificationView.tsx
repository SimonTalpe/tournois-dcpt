import { useMemo } from 'react'
import { formatSchedule } from '../../lib/schedule.ts'
import { setsWon } from '../../lib/scores.ts'
import type { QualificationRow } from '../../lib/qualification.ts'
import { dartLegsScore } from './display.ts'
import { qualificationMatches, qualificationOutlook, qualificationRounds, qualificationStandings } from './qualification.ts'
import { gameFormatLabel, type Match, type TournamentBundle } from './types.ts'

type Props = {
  bundle: TournamentBundle
  highlightPlayerId?: string | null
  onOpenMatch?: (matchId: string) => void
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/**
 * Onglet « Qualification » (maquette retenue le 24/11 : « ta situation d'abord ») :
 * bloc noir avec ton bilan et ton prochain match, classement provisoire avec le statut de chacun,
 * puis les matchs (à jouer d'abord).
 */
export function QualificationView({ bundle, highlightPlayerId, onOpenMatch }: Props) {
  const { tournament, players, locations } = bundle
  const standings = useMemo(() => qualificationStandings(bundle), [bundle])
  const rounds = qualificationRounds(bundle)
  const matches = qualificationMatches(bundle)
  const outlook = qualificationOutlook(bundle)
  if (!standings || !outlook) return null

  const wins = tournament.qualification_wins ?? 1
  const losses = tournament.qualification_losses ?? 2
  const finalExists = bundle.rounds.some((r) => r.bracket === 'main')
  const preliminary = tournament.qualification_next_stage === 'preliminary'
  const name = (id: string | null) => (id ? (players.get(id)?.full_name ?? 'Joueur inconnu') : '—')
  const roundName = (m: Match) => rounds.find((r) => r.id === m.round_id)?.name ?? ''
  const isMiniPong = tournament.discipline === 'mini_pong'

  const statusLabel = (row: QualificationRow): { text: string; tone: 'qualified' | 'active' | 'out' } => {
    if (row.status === 'qualified') {
      return preliminary && row.seed !== null && row.seed <= outlook.byes
        ? { text: 'Exempté', tone: 'qualified' }
        : { text: 'Qualifié', tone: 'qualified' }
    }
    if (row.status === 'eliminated') return { text: 'Éliminé', tone: 'out' }
    if (wins === 1 && row.losses > 0) return { text: 'Repêchage', tone: 'active' }
    return { text: row.status === 'playing' ? 'En match' : 'En attente', tone: 'active' }
  }

  const me = highlightPlayerId ? standings.rows.find((r) => r.playerId === highlightPlayerId) : undefined
  const myMatch = me ? matches.find((m) => m.status === 'pending' && [m.home_player_id, m.away_player_id].includes(me.playerId)) : undefined

  const score = (m: Match) => {
    if (m.status === 'walkover') return 'forfait'
    if (m.status !== 'played') return 'contre'
    if (!isMiniPong) {
      const legs = dartLegsScore(m)
      return legs ? `${legs.home}-${legs.away}` : 'bat'
    }
    const sets = bundle.sets.get(m.id) ?? []
    if (sets.length === 1) return `${sets[0].home}-${sets[0].away}`
    const won = setsWon(sets)
    return `${won.home}-${won.away}`
  }
  const where = (m: Match) =>
    [m.scheduled_at && formatSchedule(m.scheduled_at), locations.find((l) => l.id === m.location_id)?.name]
      .filter(Boolean)
      .join(', ')

  const pending = matches.filter((m) => m.status === 'pending')
  const done = matches.filter((m) => m.status !== 'pending').reverse()
  const qualifiedCount = standings.rows.filter((r) => r.status === 'qualified').length
  const eliminatedCount = standings.rows.filter((r) => r.status === 'eliminated').length

  return (
    <div className="space-y-6">
      {me && !finalExists && (
        <section className="-mx-4 space-y-2 bg-black px-5 py-5 text-white sm:mx-0">
          <p className="text-[15px] font-semibold">
            Toi, {plural(me.wins, 'victoire')} {plural(me.losses, 'défaite')}
          </p>
          <p className="font-display text-[34px] leading-[0.95] font-black">
            {me.status === 'qualified'
              ? statusLabel(me).text === 'Exempté'
                ? standings.complete
                  ? 'Exempté du tour préliminaire'
                  : 'Qualifié, en bonne place pour une exemption'
                : 'Qualifié pour le tableau final'
              : me.status === 'eliminated'
                ? 'Éliminé de la qualification'
                : me.losses > 0 && wins === 1
                  ? 'Au repêchage : gagne pour te qualifier'
                  : `Encore ${plural(wins - me.wins, 'victoire')} pour te qualifier`}
          </p>
          {myMatch ? (
            <>
              <p className="text-[15px]">
                Contre {name(myMatch.home_player_id === me.playerId ? myMatch.away_player_id : myMatch.home_player_id)}
                {where(myMatch) ? `, ${where(myMatch)}` : ', horaire à proposer'}
              </p>
              {onOpenMatch && (
                <button
                  type="button"
                  onClick={() => onOpenMatch(myMatch.id)}
                  className="mt-1 flex min-h-[52px] w-full items-center justify-center border-2 border-white bg-white px-4 text-[17px] font-semibold text-black hover:border-ochre-light hover:bg-ochre-light"
                >
                  Voir le match
                </button>
              )}
            </>
          ) : (
            me.status !== 'qualified' &&
            me.status !== 'eliminated' && (
              <p className="text-[15px]">En attente d’un adversaire de même bilan : ton match se crée dès qu’il est libre.</p>
            )
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-display text-[32px] leading-none font-extrabold">
            Classement{standings.complete ? '' : ' provisoire'}
          </h2>
          <span className="text-[13px] text-muted">
            {qualifiedCount} qualifiés sur {outlook.qualifiers} · {eliminatedCount} éliminés
          </span>
        </div>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-b-2 border-black text-left text-[13px]">
                <th scope="col" className="w-8 px-1 py-2 font-semibold">
                  #
                </th>
                <th scope="col" className="px-1 py-2 font-semibold">
                  Joueur
                </th>
                <th scope="col" className="px-1 py-2 text-right font-semibold">
                  <abbr title="Victoires-défaites">Bilan</abbr>
                </th>
                <th scope="col" className="px-1 py-2 text-right font-semibold">
                  <abbr title={isMiniPong ? 'Différence de points' : 'Différence de manches'}>Diff.</abbr>
                </th>
                <th scope="col" className="px-1 py-2 text-right font-semibold">
                  Statut
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.rows.map((row) => {
                const status = statusLabel(row)
                return (
                  <tr
                    key={row.playerId}
                    className={`border-b border-black ${row.playerId === highlightPlayerId ? 'bg-ochre-tint font-bold' : ''}`}
                  >
                    <td className="px-1 py-2.5 tabular-nums">{row.seed ?? ''}</td>
                    <td className="max-w-0 px-1 py-2.5">
                      <span className="block truncate">
                        {name(row.playerId)}
                        {row.tiedByDraw && (
                          <span className="text-muted" title="Égalité parfaite : départagé par tirage au sort">
                            {' '}
                            *
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-1 py-2.5 text-right tabular-nums">
                      {row.wins}-{row.losses}
                    </td>
                    <td className="px-1 py-2.5 text-right tabular-nums">{signed(row.pointsFor - row.pointsAgainst)}</td>
                    <td className="px-1 py-2.5 text-right">
                      <span
                        className={`inline-block border px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${
                          status.tone === 'qualified'
                            ? 'border-black bg-black text-white'
                            : status.tone === 'out'
                              ? 'border-dashed border-muted text-muted'
                              : 'border-ochre-text text-ochre-text'
                        }`}
                      >
                        {status.text}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] leading-snug text-muted">
          {plural(wins, 'victoire')} pour se qualifier, {plural(losses, 'défaite')} pour être éliminé. Qualifiés classés
          au nombre de défaites, puis à la différence de {isMiniPong ? 'points' : 'manches'}, puis aux{' '}
          {isMiniPong ? 'points marqués' : 'manches gagnées'} ; égalité parfaite (*) : tirage au sort.
          {preliminary && outlook.byes > 0
            ? ` Les ${outlook.byes} premiers sont exemptés du tour préliminaire.`
            : ''}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-[28px] leading-none font-extrabold">
          Matchs{' '}
          <span className="font-sans text-[15px] font-semibold text-muted">
            {plural(matches.filter((m) => m.status !== 'bye').length, 'match')}, dont {done.filter((m) => m.status !== 'bye').length} joués
          </span>
        </h2>
        <ul className="border-t-2 border-black">
          {[...pending, ...done].map((m) => {
            const mine = Boolean(highlightPlayerId && [m.home_player_id, m.away_player_id].includes(highlightPlayerId))
            if (m.status === 'bye') {
              return (
                <li key={m.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-black px-1 py-2">
                  <span className={mine ? 'font-bold' : ''}>{name(m.home_player_id)} exempté</span>
                  <span className="text-[13px] text-muted">{roundName(m)}</span>
                </li>
              )
            }
            const homeWon = m.winner_player_id === m.home_player_id && m.status !== 'pending'
            const awayWon = m.winner_player_id === m.away_player_id && m.status !== 'pending'
            return (
              <li key={m.id} className="border-b border-black">
                <button
                  type="button"
                  disabled={!onOpenMatch}
                  onClick={() => onOpenMatch?.(m.id)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-1 py-2.5 text-left enabled:hover:bg-mist ${
                    mine && m.status === 'pending' ? 'bg-ochre text-white enabled:hover:bg-ochre' : ''
                  }`}
                >
                  <span className="truncate">
                    <span className={homeWon ? 'font-bold' : ''}>{name(m.home_player_id)}</span> {score(m)}{' '}
                    <span className={awayWon ? 'font-bold' : ''}>{name(m.away_player_id)}</span>
                  </span>
                  <span className="text-[13px]">{roundName(m)}</span>
                  {m.status === 'pending' && (
                    <span className={`text-[13px] ${mine ? '' : 'text-muted'}`}>{where(m) || 'Horaire à proposer'}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        {rounds[0] && (
          <p className="text-[13px] text-muted">Format : {gameFormatLabel(tournament.discipline, rounds[0])}</p>
        )}
      </section>
    </div>
  )
}
