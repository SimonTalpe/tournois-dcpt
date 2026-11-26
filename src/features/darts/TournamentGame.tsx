import { useMemo, useState } from 'react'
import { deName } from '../../lib/french.ts'
import { Notice, PrimaryButton } from '../../components/ui.tsx'
import { recordDartMatch, recordDartTiebreak } from './api.ts'
import { medal, type Dart } from './darts.ts'
import { replay } from './engine.ts'
import { GameScreen } from './GameScreen.tsx'
import { canUndo, matchProgress, pushEvent, recordedLegs, startNextLeg, summarizeLegs, undoLast } from './match.ts'
import type { SavedGame } from './storage.ts'
import { vibrate } from './useWakeLock.ts'

type Props = {
  game: SavedGame
  onChange: (game: SavedGame) => void
  /** Fin (résultat enregistré ou partie abandonnée) : on efface la partie et on retourne au tournoi. */
  onLeave: (path: string) => void
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }

/** Compteur lancé depuis un match ou un départage de tournoi : joueurs et format imposés. */
export function TournamentGame({ game, onChange, onLeave }: Props) {
  const context = game.context
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const state = useMemo(() => replay(game.config, game.events), [game.config, game.events])
  const progress = useMemo(() => matchProgress(game), [game])
  if (!context) return null

  const name = (playerId: string | null) => context.players.find((p) => p.playerId === playerId)?.name ?? '?'
  const backPath =
    context.kind === 'match'
      ? `/tournois/${context.tournamentId}?match=${context.matchId}`
      : `/tournois/${context.tournamentId}?onglet=poules`
  const legNumber = (game.previousLegs?.length ?? 0) + 1
  const format = `${context.start}${context.doubleOut ? ' · sortie double' : ''}`

  function dart(d: Dart) {
    const next = pushEvent(game, { type: 'dart', dart: d })
    if (!next) return
    if (next.state.lastTurn !== next.previous.lastTurn && next.state.lastTurn) {
      if (next.state.lastTurn.finished) vibrate([60, 40, 160])
      else if (next.state.lastTurn.bust) vibrate([90, 50, 90])
    }
    onChange(next.game)
  }

  function undo() {
    if (game.recorded) return
    setSave({ kind: 'idle' })
    onChange(undoLast(game))
  }

  async function record() {
    if (!context) return
    setSave({ kind: 'saving' })
    try {
      const legs = recordedLegs(game)
      if (context.kind === 'match') await recordDartMatch(context.matchId, legs)
      else await recordDartTiebreak(context.poolId, legs[0])
      setSave({ kind: 'idle' })
      onChange({ ...game, recorded: true })
    } catch (e) {
      setSave({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  function abandon() {
    onLeave(backPath)
  }

  const banner = (
    <div className="rounded-2xl bg-court px-4 py-2.5 text-chalk">
      <p className="truncate text-xs text-white">
        {context.tournamentName} · {context.label}
      </p>
      <p className="truncate text-xs text-white">
        {format}
        {context.kind === 'match' && context.legsToWin > 1 && ` · ${context.legsToWin} manches gagnantes`}
      </p>
      {context.kind === 'match' ? (
        <p className="flex items-center justify-between gap-2 font-semibold">
          <span className="min-w-0 truncate">{context.players[0].name}</span>
          <span className="shrink-0 rounded-lg bg-chalk/15 px-2 tabular-nums">
            {progress.legsWon.get(context.players[0].playerId) ?? 0} – {progress.legsWon.get(context.players[1].playerId) ?? 0}
          </span>
          <span className="min-w-0 truncate text-right">{context.players[1].name}</span>
        </p>
      ) : (
        <p className="font-semibold">Départage : partie jouée jusqu'au bout</p>
      )}
    </div>
  )

  if (progress.status === 'playing') {
    return (
      <section className="space-y-3">
        {banner}
        {context.kind === 'match' && context.legsToWin > 1 && (
          <p className="text-sm font-medium text-court">
            Manche {legNumber} · {game.config.players[0].name} commence
          </p>
        )}
        <GameScreen
          config={game.config}
          state={state}
          canUndo={canUndo(game)}
          abandon
          onDart={dart}
          onUndo={undo}
          onContinue={() => undefined}
          onStop={abandon}
        />
      </section>
    )
  }

  if (progress.status === 'leg_over') {
    const legWinnerName = name(state.lastFinisher !== null ? game.config.players[state.lastFinisher].key : null)
    const nextFirst = game.config.players[1].name
    return (
      <section className="space-y-4">
        {banner}
        <div className="space-y-2 rounded-2xl bg-white p-5 text-center border-2 border-black">
          <p className="text-sm text-muted">Manche {legNumber}</p>
          <p className="text-2xl font-bold text-court">{legWinnerName} gagne la manche</p>
          <p className="text-sm text-muted">Manche suivante : {nextFirst} commence.</p>
        </div>
        <PrimaryButton type="button" onClick={() => onChange(startNextLeg(game))}>
          ▶ Manche suivante
        </PrimaryButton>
        <button type="button" onClick={undo} className="w-full py-2 text-sm text-muted underline">
          ↶ Erreur de saisie : revenir à la manche
        </button>
      </section>
    )
  }

  // Match (ou départage) terminé : récapitulatif et validation.
  const legs = recordedLegs(game)
  const summary = summarizeLegs(legs)
  return (
    <section className="space-y-5">
      {banner}
      <div>
        <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">
          {context.kind === 'match' ? `Victoire ${deName(name(progress.winner))}` : 'Départage terminé'}
        </h1>
        <p className="text-sm text-muted">Vérifie le résultat avant de le valider : il sera reporté dans le tournoi.</p>
      </div>

      {context.kind === 'match' ? (
        <div className="space-y-2">
          {legs.length > 1 && (
            <ol className="divide-y divide-black rounded-2xl bg-white text-sm border-2 border-black">
              {summary.lines.map((line) => {
                const loser = context.players.find((p) => p.playerId !== line.winner)
                return (
                  <li key={line.number} className="flex justify-between gap-3 px-4 py-2">
                    <span className="text-muted">Manche {line.number}</span>
                    <span className="truncate">
                      <span className="font-semibold">{name(line.winner)}</span>
                      {loser && ` · ${loser.name} reste ${line.remaining.get(loser.playerId)}`}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          <ul className="divide-y divide-black rounded-2xl bg-white border-2 border-black">
            {context.players.map((p) => {
              const totals = summary.totals.find((t) => t.playerId === p.playerId)
              const isWinner = p.playerId === progress.winner
              return (
                <li key={p.playerId} className="flex items-center gap-3 px-4 py-3">
                  <span className={`min-w-0 flex-1 truncate ${isWinner ? 'font-bold text-court' : ''}`}>{p.name}</span>
                  <span className="text-xs text-muted">
                    {totals?.darts ?? 0} fléchettes{totals?.average != null && ` · moy. ${totals.average}`}
                  </span>
                  <span className="w-6 text-right text-xl font-bold tabular-nums">{progress.legsWon.get(p.playerId) ?? 0}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <ol className="divide-y divide-black rounded-2xl bg-white border-2 border-black">
          {[...legs[0].players]
            .sort((a, b) => a.rank - b.rank)
            .map((p) => (
              <li key={p.player_id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-9 shrink-0 text-center text-xl font-bold">{medal(p.rank)}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{name(p.player_id)}</span>
                <span className="text-xs text-muted">{p.remaining === 0 ? 'a fini' : `reste ${p.remaining}`}</span>
              </li>
            ))}
        </ol>
      )}

      {game.recorded ? (
        <>
          <Notice tone="success">Résultat enregistré et reporté dans le tournoi.</Notice>
          <PrimaryButton type="button" onClick={() => onLeave(backPath)}>
            Retour au tournoi
          </PrimaryButton>
        </>
      ) : (
        <div className="space-y-2">
          {save.kind === 'error' && <Notice tone="error">{save.message}</Notice>}
          <PrimaryButton type="button" busy={save.kind === 'saving'} onClick={() => void record()}>
            {save.kind === 'error' ? 'Réessayer l’enregistrement' : 'Valider et reporter le résultat'}
          </PrimaryButton>
          {save.kind === 'error' && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Abandonner cette partie ? Elle ne sera pas enregistrée.')) abandon()
              }}
              className="w-full rounded-xl border border-ochre-text bg-white py-3 font-semibold text-clay"
            >
              Abandonner la partie
            </button>
          )}
          {save.kind !== 'saving' && (
            <button type="button" onClick={undo} className="w-full py-2 text-sm text-muted underline">
              ↶ Erreur de saisie : revenir à la partie
            </button>
          )}
        </div>
      )}
    </section>
  )
}
