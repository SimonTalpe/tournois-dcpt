import { useEffect, useMemo, useState } from 'react'
import { Notice, SecondaryButton } from '../../components/ui.tsx'
import { canSchedule } from '../../lib/schedule.ts'
import { checkMiniPongSets, maxSets, parseSetRows, resultRights, setsWon, type Side } from '../../lib/scores.ts'
import { clearResult, submitResult, swapHomeAway } from './api.ts'
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

  const rights = resultRights(
    {
      status: match.status,
      homePlayerId: match.home_player_id,
      awayPlayerId: match.away_player_id,
      resultBy: match.result_by,
      resultByAdmin: match.result_by_admin,
      resultFirstAt: match.result_first_at,
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
      return run(() => submitResult(match.id, { winnerPlayerId: dartWinner }))
    }
    if ('error' in parsed) return setError(parsed.error)
    const checked = checkMiniPongSets(parsed.sets, setsToWin)
    if (!checked.ok) return setError(checked.error)
    const winnerName = name(sideId(checked.winner))
    if (!window.confirm(`Enregistrer la victoire de ${winnerName} ?`)) return
    return run(() => submitResult(match.id, { sets: parsed.sets }))
  }

  async function swap() {
    if (!window.confirm('Inverser domicile et extérieur pour ce match ?')) return
    setBusy(true)
    setError(null)
    try {
      await swapHomeAway(match.id)
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    if (!window.confirm('Effacer ce résultat ? Le match redevient « à jouer ».')) return
    return run(() => clearResult(match.id))
  }

  const played = match.status === 'played'
  const won = setsWon(existingSets)
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
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="match-dialog-title" className="text-lg font-bold text-court">
              {number ? `Match M${number}` : pool ? `Poule ${pool.label}` : 'Match'}
            </h2>
            <p className="text-sm text-ink/60">
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
            const isWinner = played && id === match.winner_player_id
            return (
              <li
                key={side}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                  isWinner ? 'bg-court/10 font-bold text-court' : 'bg-chalk'
                } ${id && id === viewer.playerId ? 'ring-2 ring-ball' : ''}`}
              >
                <span className="truncate">
                  {name(id)}
                  {side === 'home' && <span className="ml-2 text-[10px] font-normal text-ink/40 uppercase">dom.</span>}
                </span>
                {played && (
                  <span className="shrink-0">{isDarts ? (isWinner ? 'Vainqueur' : '') : won[side]}</span>
                )}
              </li>
            )
          })}
        </ul>

        {viewer.isAdmin && match.status === 'pending' && ['in_progress', 'finished'].includes(tournament.status) && (
          <SecondaryButton disabled={busy} onClick={() => void swap()}>
            ⇄ Inverser domicile / extérieur
          </SecondaryButton>
        )}

        {played && (
          <div className="space-y-1 text-sm">
            {!isDarts && existingSets.length > 0 && (
              <p>
                Sets :{' '}
                <span className="font-semibold">{existingSets.map((s) => `${s.home}-${s.away}`).join(' · ')}</span>
              </p>
            )}
            {match.result_at && (
              <p className="text-xs text-ink/50">
                Saisi {author ? `par ${author}` : match.result_by_admin ? "par l'admin" : ''}
                {match.result_by_admin && author ? ' (admin)' : ''} le {dateTimeFormat.format(new Date(match.result_at))}
              </p>
            )}
          </div>
        )}
        {match.status === 'pending' && !rights.canEdit && <p className="text-sm text-ink/60">Match à jouer.</p>}
        {!rights.canEdit && rights.reason && played && <Notice>{rights.reason}</Notice>}

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
          <div className="space-y-3 border-t border-ink/10 pt-4">
            <h3 className="font-semibold">{played ? 'Corriger le résultat' : 'Saisir le résultat'}</h3>
            {rights.deadline && (
              <p className="text-xs text-ink/60">Correction possible jusqu'à {timeFormat.format(rights.deadline)}.</p>
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
                        dartWinner === id ? 'border-court bg-court text-chalk' : 'border-ink/20 hover:bg-court/10'
                      }`}
                    >
                      🎯 Victoire de {name(id)}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-xs text-ink/60">
                  <span />
                  <span className="truncate text-center">{name(match.home_player_id)}</span>
                  <span className="truncate text-center">{name(match.away_player_id)}</span>
                </div>
                {rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                    <span className="text-sm text-ink/60">Set {i + 1}</span>
                    {(['home', 'away'] as const).map((side) => (
                      <input
                        key={side}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        aria-label={`Set ${i + 1} — points de ${name(sideId(side))}`}
                        className="w-full rounded-xl border border-ink/20 px-3 py-2.5 text-center text-base outline-none focus:ring-2 focus:ring-court/40"
                        value={row[side]}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '')
                          setRows((current) => current.map((r, j) => (j === i ? { ...r, [side]: value } : r)))
                        }}
                      />
                    ))}
                  </div>
                ))}
                <p className="text-xs text-ink/60">
                  {setsToWin} set{setsToWin > 1 ? 's' : ''} gagnant{setsToWin > 1 ? 's' : ''} de 11 points, 2 points
                  d'écart. Laisse vides les sets non joués.
                </p>
                {preview && (
                  <p className={`text-sm ${preview.ok ? 'text-court' : 'text-ink/60'}`}>
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
