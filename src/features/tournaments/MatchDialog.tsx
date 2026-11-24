import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { prepareTournamentGame } from '../darts/launch.ts'
import { MatchLegsDetail } from '../darts/MatchLegsDetail.tsx'
import { canSchedule } from '../../lib/schedule.ts'
import { checkMiniPongSets, maxSets, parseSetRows, resultRights, setsWon, type Side } from '../../lib/scores.ts'
import { cancelMatch, clearResult, reopenMatch, setWalkover, submitResult, swapHomeAway } from './api.ts'
import { numberMatches } from './display.ts'
import { ScheduleSection } from './ScheduleSection.tsx'
import { gameFormatLabel, type Match, type TournamentBundle } from './types.ts'

export type Viewer = { isAdmin: boolean; isActivePlayer: boolean; profileId: string | null; playerId: string | null }

type Props = {
  bundle: TournamentBundle
  match: Match
  viewer: Viewer
  onClose: () => void
  /** Après un enregistrement : recharger le tournoi. */
  onSaved: () => Promise<void>
}

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Détail d'un match : résultat, auteur, et formulaire de saisie / correction si autorisé. */
export function MatchDialog({ bundle, match, viewer, onClose, onSaved }: Props) {
  const { tournament, rounds, players, sets, authors, matches } = bundle
  const round = rounds.find((r) => r.id === match.round_id)
  const setsToWin = round?.sets_to_win ?? 2
  const isDarts = tournament.discipline === 'darts'
  const number = useMemo(() => numberMatches(rounds, matches).get(match.id), [rounds, matches, match.id])
  const pool = bundle.pools.find((p) => p.id === match.pool_id)
  const existingSets = sets.get(match.id) ?? []
  const name = (id: string | null) => (id ? (players.get(id)?.full_name ?? 'Joueur inconnu') : 'À déterminer')
  const sideId = (side: Side) => (side === 'home' ? match.home_player_id : match.away_player_id)

  // Résultats de poule ou de qualification figés une fois la phase finale générée.
  const matchRound = rounds.find((r) => r.id === match.round_id)
  const frozenByFinalPhase =
    (Boolean(match.pool_id) || matchRound?.bracket === 'qualification') &&
    rounds.some((r) => r.bracket === 'main' || r.bracket === 'third_place' || r.bracket === 'consolation')

  const rights = resultRights(
    {
      status: match.status,
      homePlayerId: match.home_player_id,
      awayPlayerId: match.away_player_id,
      resultBy: match.result_by,
      resultByAdmin: match.result_by_admin,
      resultFirstAt: match.result_first_at,
      poolLocked: frozenByFinalPhase,
    },
    viewer,
    tournament.status,
  )

  const [rows, setRows] = useState(() =>
    Array.from({ length: maxSets(setsToWin) }, (_, i) => ({
      home: existingSets[i]?.home.toString() ?? '',
      away: existingSets[i]?.away.toString() ?? '',
    })),
  )
  const [dartWinner, setDartWinner] = useState<string | null>(match.winner_player_id)
  /** Fléchettes en plusieurs manches : manches gagnées par le perdant. */
  const [loserLegs, setLoserLegs] = useState(() =>
    match.home_legs !== null && match.away_legs !== null ? Math.min(match.home_legs, match.away_legs) : 0,
  )
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Échap ferme la fenêtre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const parsed = parseSetRows(rows)
  const preview = 'sets' in parsed && parsed.sets.length > 0 ? checkMiniPongSets(parsed.sets, setsToWin) : null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (isDarts) {
      if (!dartWinner) return setError('Choisis le vainqueur.')
      const winnerIsHome = dartWinner === match.home_player_id
      const legs = winnerIsHome ? { home: setsToWin, away: loserLegs } : { home: loserLegs, away: setsToWin }
      if (setsToWin > 1 && !window.confirm(`Enregistrer la victoire de ${name(dartWinner)} (${legs.home}-${legs.away}) ?`)) return
      return run(() => submitResult(match.id, { legs }))
    }
    if ('error' in parsed) return setError(parsed.error)
    const checked = checkMiniPongSets(parsed.sets, setsToWin)
    if (!checked.ok) return setError(checked.error)
    const winnerName = name(sideId(checked.winner))
    if (!window.confirm(`Enregistrer la victoire de ${winnerName} ?`)) return
    return run(() => submitResult(match.id, { sets: parsed.sets }))
  }

  /** Action de l'admin sur le match (la fenêtre reste ouverte). */
  async function adminAction(confirmText: string, action: () => Promise<void>) {
    if (!window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    try {
      await action()
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Compteur de fléchettes avec les joueurs et le format du match (le joueur à domicile commence). */
  function playWithCounter() {
    if (!match.home_player_id || !match.away_player_id || !round) return
    const ready = prepareTournamentGame({
      kind: 'match',
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      label: number ? `${round.name} · M${number}` : pool ? `Poule ${pool.label}` : round.name,
      matchId: match.id,
      legsToWin: round.sets_to_win,
      start: round.dart_start === 501 ? 501 : 301,
      doubleOut: round.dart_double_out,
      players: [
        { playerId: match.home_player_id, name: name(match.home_player_id) },
        { playerId: match.away_player_id, name: name(match.away_player_id) },
      ],
    })
    if (ready) navigate('/compteur')
  }

  function clear() {
    if (!window.confirm('Effacer ce résultat ? Le match redevient « à jouer ».')) return
    return run(() => clearResult(match.id))
  }

  const played = match.status === 'played'
  const decided = played || match.status === 'walkover'
  const canAct = viewer.isAdmin && ['in_progress', 'finished'].includes(tournament.status)
  const poolLocked = frozenByFinalPhase
  const won = isDarts ? { home: match.home_legs ?? 0, away: match.away_legs ?? 0 } : setsWon(existingSets)
  const showDartLegs = isDarts && (match.home_legs ?? 0) + (match.away_legs ?? 0) > 1
  const author = match.result_by ? authors.get(match.result_by) : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-dialog-title"
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 border-t-4 border-black sm:border-2 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="match-dialog-title" className="text-lg font-bold text-court">
              {number ? `Match M${number}` : pool ? `Poule ${pool.label}` : round?.bracket === 'qualification' ? 'Qualification' : 'Match'}
            </h2>
            <p className="text-sm text-muted">
              {round?.bracket === 'pool' ? 'Poules' : round?.name}
              {round && ` · ${gameFormatLabel(tournament.discipline, round)}`}
            </p>
          </div>
          <SecondaryButton onClick={onClose} ariaLabel="Fermer">
            ✕
          </SecondaryButton>
        </header>

        <ul className="space-y-1">
          {(['home', 'away'] as const).map((side) => {
            const id = sideId(side)
            const isWinner = decided && Boolean(id) && id === match.winner_player_id
            const isForfeit = match.status === 'walkover' && id === match.forfeit_player_id
            return (
              <li
                key={side}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                  isWinner ? 'bg-mist font-bold text-court' : 'bg-chalk'
                } ${id && id === viewer.playerId ? 'ring-2 ring-ball' : ''}`}
              >
                <span className="truncate">
                  {name(id)}
                  {side === 'home' && <span className="ml-2 text-[10px] font-normal text-muted">dom.</span>}
                </span>
                {played && (
                  <span className="shrink-0">{isDarts && !showDartLegs ? (isWinner ? 'Vainqueur' : '') : won[side]}</span>
                )}
                {isForfeit && <span className="shrink-0 text-xs font-semibold text-clay">forfait</span>}
              </li>
            )
          })}
        </ul>

        {match.status === 'walkover' && (
          <Notice>
            Forfait de {name(match.forfeit_player_id)} :{' '}
            {match.winner_player_id
              ? `${name(match.winner_player_id)} est qualifié d'office.`
              : "son adversaire sera qualifié d'office dès qu'il sera connu."}
          </Notice>
        )}
        {match.status === 'cancelled' && <Notice>Match annulé : il ne compte pas dans le classement de la poule.</Notice>}

        {played && (
          <div className="space-y-1 text-sm">
            {!isDarts && existingSets.length > 0 && (
              <p>
                Sets :{' '}
                <span className="font-semibold">{existingSets.map((s) => `${s.home}-${s.away}`).join(' · ')}</span>
              </p>
            )}
            {isDarts && viewer.isActivePlayer && match.home_player_id && match.away_player_id && (
              <MatchLegsDetail
                matchId={match.id}
                resultAt={match.result_at}
                playerIds={[match.home_player_id, match.away_player_id]}
                name={(id) => name(id)}
              />
            )}
            {match.result_at && (
              <p className="text-xs text-muted">
                Saisi {author ? `par ${author}` : match.result_by_admin ? "par l'admin" : ''}
                {match.result_by_admin && author ? ' (admin)' : ''} le {dateTimeFormat.format(new Date(match.result_at))}
              </p>
            )}
          </div>
        )}
        {match.status === 'pending' && !rights.canEdit && <p className="text-sm text-muted">Match à jouer.</p>}
        {!rights.canEdit && rights.reason && (played || match.pool_id) && <Notice>{rights.reason}</Notice>}

        {canAct && !poolLocked && (match.status === 'pending' || match.status === 'walkover' || match.status === 'cancelled') && (
          <div className="space-y-2 border-t border-black pt-4">
            <h3 className="font-semibold">Actions admin</h3>
            <div className="flex flex-wrap gap-2">
              {match.status === 'pending' && (
                <>
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => void adminAction('Inverser domicile et extérieur pour ce match ?', () => swapHomeAway(match.id))}
                  >
                    ⇄ Inverser domicile / extérieur
                  </SecondaryButton>
                  {(['home', 'away'] as const).map((side) => {
                    const id = sideId(side)
                    if (!id) return null
                    return (
                      <SecondaryButton
                        key={side}
                        danger
                        disabled={busy}
                        onClick={() =>
                          void adminAction(
                            `Déclarer ${name(id)} forfait ? Son adversaire sera qualifié${
                              sideId(side === 'home' ? 'away' : 'home') ? '' : " d'office dès qu'il sera connu"
                            }.`,
                            () => setWalkover(match.id, id),
                          )
                        }
                      >
                        Forfait de {name(id)}
                      </SecondaryButton>
                    )
                  })}
                  {match.pool_id && (
                    <SecondaryButton
                      danger
                      disabled={busy}
                      onClick={() =>
                        void adminAction('Annuler ce match ? Il ne comptera pas dans le classement de la poule.', () =>
                          cancelMatch(match.id),
                        )
                      }
                    >
                      Annuler le match
                    </SecondaryButton>
                  )}
                </>
              )}
              {(match.status === 'walkover' || match.status === 'cancelled') && (
                <SecondaryButton
                  disabled={busy}
                  onClick={() =>
                    void adminAction('Rétablir ce match ? Il redevient « à jouer ».', () => reopenMatch(match.id))
                  }
                >
                  ↺ Rétablir le match
                </SecondaryButton>
              )}
            </div>
            {!rights.canEdit && error && <Notice tone="error">{error}</Notice>}
          </div>
        )}

        {match.status !== 'bye' && (
          <ScheduleSection
            match={match}
            locations={bundle.locations}
            canEdit={canSchedule(
              { status: match.status, homePlayerId: match.home_player_id, awayPlayerId: match.away_player_id },
              viewer,
              tournament.status,
            )}
            onSaved={onSaved}
          />
        )}

        {rights.canEdit && (
          <div className="space-y-3 border-t border-black pt-4">
            <h3 className="font-semibold">{played ? 'Corriger le résultat' : 'Saisir le résultat'}</h3>
            {rights.deadline && (
              <p className="text-xs text-muted">Correction possible jusqu'à {timeFormat.format(rights.deadline)}.</p>
            )}
            {isDarts && match.status === 'pending' && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={playWithCounter}
                  disabled={busy}
                  className="w-full rounded-xl bg-ochre px-4 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  Jouer au compteur
                </button>
                <p className="text-center text-xs text-muted">
                  {round ? gameFormatLabel(tournament.discipline, round) : ''} · {name(match.home_player_id)} commence.
                  Ou saisis le résultat à la main :
                </p>
              </div>
            )}
            {isDarts ? (
              <div className="grid gap-2">
                {(['home', 'away'] as const).map((side) => {
                  const id = sideId(side) as string
                  return (
                    <button
                      key={side}
                      type="button"
                      aria-pressed={dartWinner === id}
                      onClick={() => setDartWinner(id)}
                      className={`rounded-xl border px-3 py-3 text-left font-medium transition ${
                        dartWinner === id ? 'border-court bg-court text-chalk' : 'border-black hover:bg-mist'
                      }`}
                    >
                      Victoire de {name(id)}
                    </button>
                  )
                })}
                {setsToWin > 1 && (
                  <fieldset className="space-y-1">
                    <legend className="text-sm text-muted">
                      Manches gagnées par {dartWinner ? `l'adversaire de ${name(dartWinner)}` : 'le perdant'}
                    </legend>
                    <div className="flex gap-2">
                      {Array.from({ length: setsToWin }, (_, n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={loserLegs === n}
                          onClick={() => setLoserLegs(n)}
                          className={`flex-1 rounded-xl border py-2 font-semibold tabular-nums ${
                            loserLegs === n ? 'border-court bg-court text-chalk' : 'border-black hover:bg-mist'
                          }`}
                        >
                          {setsToWin}-{n}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-xs text-muted">
                  <span />
                  <span className="truncate text-center">{name(match.home_player_id)}</span>
                  <span className="truncate text-center">{name(match.away_player_id)}</span>
                </div>
                {rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                    <span className="text-sm text-muted">Set {i + 1}</span>
                    {(['home', 'away'] as const).map((side) => (
                      <input
                        key={side}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        aria-label={`Set ${i + 1} — points de ${name(sideId(side))}`}
                        className="w-full rounded-xl border border-black px-3 py-2.5 text-center text-base outline-none focus:ring-2 focus:ring-ochre"
                        value={row[side]}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '')
                          setRows((current) => current.map((r, j) => (j === i ? { ...r, [side]: value } : r)))
                        }}
                      />
                    ))}
                  </div>
                ))}
                <p className="text-xs text-muted">
                  {setsToWin} set{setsToWin > 1 ? 's' : ''} gagnant{setsToWin > 1 ? 's' : ''} de 11 points, 2 points
                  d'écart. Laisse vides les sets non joués.
                </p>
                {preview && (
                  <p className={`text-sm ${preview.ok ? 'text-court' : 'text-muted'}`}>
                    {preview.ok ? `✓ Victoire de ${name(sideId(preview.winner))}` : preview.error}
                  </p>
                )}
              </div>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="flex-1 rounded-xl bg-court px-4 py-3 font-semibold text-chalk transition hover:bg-court-light disabled:opacity-60"
              >
                {busy ? 'Patiente…' : 'Enregistrer'}
              </button>
              {played && (
                <SecondaryButton danger disabled={busy} onClick={() => void clear()}>
                  Effacer le résultat
                </SecondaryButton>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
