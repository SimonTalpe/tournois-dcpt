import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dartLabel, dartValue, medal, placeLabel, suggestCheckout, type Dart, type Multiplier } from './darts.ts'
import {
  liveRemaining,
  threeDartAverage,
  unfinishedCount,
  type GameConfig,
  type GameState,
} from './engine.ts'

type Props = {
  config: GameConfig
  state: GameState
  canUndo: boolean
  /** Match de tournoi : « Arrêter » abandonne la partie (rien n'est enregistré, le match reste à jouer). */
  abandon?: boolean
  onDart: (dart: Dart) => void
  onUndo: () => void
  onContinue: () => void
  onStop: () => void
}

const SEGMENTS = Array.from({ length: 20 }, (_, i) => i + 1)

/** Écran de jeu : tableau des scores, volée en cours, finish conseillé, pavé de saisie. */
export function GameScreen({ config, state, canUndo, abandon = false, onDart, onUndo, onContinue, onStop }: Props) {
  const [multiplier, setMultiplier] = useState<Multiplier>(1)
  const [confirmStop, setConfirmStop] = useState(false)
  const currentRef = useRef<HTMLLIElement>(null)
  const current = state.current
  const remaining = liveRemaining(state, current)
  const dartsLeft = 3 - state.turnDarts.length
  const checkout = state.phase === 'playing' ? suggestCheckout(remaining, dartsLeft, config.doubleOut) : null
  const player = state.players[current]
  const turnTotal = state.turnDarts.reduce((s, d) => s + dartValue(d), 0)

  function throwDart(segment: number) {
    const m = segment === 0 ? 1 : segment === 25 && multiplier === 3 ? 1 : multiplier
    onDart({ segment, multiplier: m })
    setMultiplier(1)
  }

  // Raccourcis clavier (ordinateur) : D = double, T = triple, Retour arrière = annuler.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'd') setMultiplier((m) => (m === 2 ? 1 : 2))
      else if (key === 't') setMultiplier((m) => (m === 3 ? 1 : 3))
      else if (key === 'backspace' && canUndo) {
        e.preventDefault()
        onUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canUndo, onUndo])

  // Bandeau des scores (mobile) : le joueur qui lance reste visible.
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [current])

  const last = state.lastTurn
  const lastName = last ? config.players[last.player].name : ''

  return (
    <div className="counter-dark -mx-4 space-y-3 bg-black px-4 py-4 text-white sm:-mx-6 sm:px-6 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-6 md:space-y-0">
      {/* Tableau des scores : bandeau défilant sur mobile, liste sur ordinateur */}
      <section aria-label="Scores" className="md:order-1">
        <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {config.players.map((p, i) => {
            const ps = state.players[i]
            const isCurrent = i === current && state.phase === 'playing'
            const avg = threeDartAverage(ps.points, ps.darts)
            return (
              <li
                key={p.key}
                ref={i === current ? currentRef : undefined}
                aria-current={isCurrent ? 'true' : undefined}
                className={`min-w-[7.5rem] shrink-0 rounded-xl border-2 px-3 py-2 md:flex md:items-center md:justify-between md:gap-3 ${
                  isCurrent
                    ? 'border-court bg-court text-chalk'
                    : ps.finishRank !== null
                      ? 'border-transparent bg-ochre-tint'
                      : 'border-transparent bg-white'
                }`}
              >
                <span className="block truncate text-sm font-medium md:flex-1">{p.name}</span>
                <span className="flex items-baseline gap-2">
                  {ps.finishRank !== null ? (
                    <span className="text-xl font-bold">{medal(ps.finishRank)}</span>
                  ) : (
                    <span className="text-2xl font-bold tabular-nums">{liveRemaining(state, i)}</span>
                  )}
                  <span className={`text-xs tabular-nums ${isCurrent ? 'text-white' : 'text-muted'}`}>
                    {avg !== null ? `moy. ${avg}` : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-label="Saisie" className="space-y-3 md:order-2">
        {/* Joueur qui lance */}
        <div className="rounded-2xl bg-white p-4 border-2 border-black">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {config.start}, {config.doubleOut ? 'sortie double' : 'sortie simple'}, volée {player.turns + 1}
            </p>
            <button
              type="button"
              onClick={() => setConfirmStop(true)}
              className="min-h-11 border-2 border-white px-3 text-sm font-semibold text-white"
            >
              {abandon ? 'Abandonner' : 'Arrêter'}
            </button>
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="min-w-0 truncate text-lg font-bold text-court">{config.players[current].name}</p>
            <p className="font-display text-[88px] leading-[0.85] font-black tabular-nums text-ochre-light" aria-label="Score restant">
              {remaining}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`rounded-lg py-2 text-center font-semibold tabular-nums ${
                  state.turnDarts[i] ? 'bg-mist text-court' : 'border border-dashed border-black text-muted'
                }`}
              >
                {state.turnDarts[i] ? dartLabel(state.turnDarts[i]) : '–'}
              </span>
            ))}
            <span className="w-12 text-right font-bold tabular-nums">{turnTotal > 0 ? `+${turnTotal}` : ''}</span>
          </div>
          <div className="mt-2 min-h-6 text-sm" aria-live="polite">
            {checkout ? (
              <p className="font-semibold text-court">
                Finish conseillé : {checkout.map(dartLabel).join(' puis ')}
              </p>
            ) : last ? (
              <p className={last.bust ? 'bg-ochre px-3 py-2 font-semibold text-white' : 'text-muted'}>
                {last.bust ? `Bust pour ${lastName}, son score revient au début de la volée.` : `${lastName} : ${last.total}`}
                {last.darts.length > 0 && !last.bust && <span className="text-muted"> ({last.darts.map(dartLabel).join(', ')})</span>}
              </p>
            ) : (
              <p className="text-muted">3 fléchettes par volée.</p>
            )}
          </div>
        </div>

        {/* Pavé de saisie */}
        <div className="touch-manipulation space-y-2 select-none">
          <div className="grid grid-cols-3 gap-2">
            <ToggleKey active={multiplier === 2} onClick={() => setMultiplier((m) => (m === 2 ? 1 : 2))}>
              Double
            </ToggleKey>
            <ToggleKey active={multiplier === 3} onClick={() => setMultiplier((m) => (m === 3 ? 1 : 3))}>
              Triple
            </ToggleKey>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="rounded-xl bg-mist py-3 font-semibold text-ink active:scale-95 disabled:opacity-30"
            >
              Annuler
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {SEGMENTS.map((n) => (
              <Key key={n} onClick={() => throwDart(n)} highlight={multiplier !== 1}>
                {multiplier === 1 ? n : `${multiplier === 2 ? 'D' : 'T'}${n}`}
              </Key>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Key onClick={() => throwDart(25)} disabled={multiplier === 3} highlight={multiplier === 2}>
              {multiplier === 2 ? 'Bull (50)' : '25'}
            </Key>
            <Key onClick={() => throwDart(0)}>0, raté</Key>
          </div>
        </div>

      </section>

      {state.phase === 'decision' && state.lastFinisher !== null && (
        <Dialog title={`${config.players[state.lastFinisher].name} termine ${placeLabel(state.players[state.lastFinisher].finishRank ?? 1)} !`}>
          <p className="text-sm text-muted">
            Il reste {unfinishedCount(state)} joueurs en lice. On continue pour les places suivantes ?
          </p>
          <div className="space-y-2">
            <button
              type="button"
              autoFocus
              onClick={onContinue}
              className="w-full rounded-xl bg-court py-3 font-semibold text-chalk active:scale-[0.98]"
            >
              Continuer la partie
            </button>
            <button
              type="button"
              onClick={onStop}
              className="w-full rounded-xl border border-black py-3 font-semibold text-court"
            >
              S'arrêter là (classement actuel)
            </button>
            <button type="button" onClick={onUndo} className="w-full py-2 text-sm text-muted underline">
              ↶ Erreur de saisie : annuler la dernière fléchette
            </button>
          </div>
        </Dialog>
      )}

      {confirmStop && state.phase === 'playing' && (
        <Dialog title={abandon ? 'Abandonner la partie ?' : 'Arrêter la partie ?'}>
          <p className="text-sm text-muted">
            {abandon
              ? 'Rien ne sera enregistré : le match reste à jouer (ou à saisir à la main).'
              : state.finishedCount === 0
                ? 'Aucun joueur n’a terminé : la partie sera annulée et rien ne sera enregistré.'
                : 'Le classement sera établi en l’état : ceux qui ont fini, puis les autres selon leur score restant.'}
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setConfirmStop(false)
                onStop()
              }}
              className="w-full rounded-xl bg-clay py-3 font-semibold text-white"
            >
              {abandon ? 'Abandonner' : state.finishedCount === 0 ? 'Annuler la partie' : 'Arrêter et classer'}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmStop(false)}
              className="w-full rounded-xl border border-black py-3 font-semibold text-court"
            >
              Reprendre la partie
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Key({
  children,
  onClick,
  disabled,
  highlight,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  highlight?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[52px] border-2 border-black font-display text-[26px] font-extrabold tabular-nums disabled:opacity-30 md:min-h-[64px] ${
        highlight ? 'bg-ochre text-white' : 'bg-white text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ToggleKey({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl py-3 font-semibold transition active:scale-95 ${
        active ? 'bg-court text-chalk ring-2 ring-ball' : 'border-2 border-black bg-white text-court'
      }`}
    >
      {children}
    </button>
  )
}

export function Dialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] border-t-4 border-black sm:border-2 sm:rounded-3xl">
        <h2 className="font-display text-[30px] leading-none font-extrabold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
