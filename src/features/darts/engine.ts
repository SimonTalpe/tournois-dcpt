/**
 * Moteur du compteur de fléchettes (301 / 501, sortie sur double ou non).
 *
 * L'état de la partie est toujours recalculé à partir de la configuration et de la liste
 * des événements (fléchettes, « continuer », « arrêter ») : annuler = retirer le dernier
 * événement. Simple, sûr, et facile à sauvegarder sur l'appareil.
 */
import { dartValue, isDouble, isValidDart, type Dart } from './darts.ts'

export type GameMode = 301 | 501

export type GameConfig = {
  start: GameMode
  doubleOut: boolean
  /** Joueurs dans l'ordre de jeu (1 à 10). */
  players: { key: string; name: string }[]
}

export type GameEvent = { type: 'dart'; dart: Dart } | { type: 'continue' } | { type: 'stop' }

export type TurnSummary = { player: number; darts: Dart[]; total: number; bust: boolean; finished: boolean }

export type PlayerState = {
  /** Score restant validé (au début de la volée en cours pour le joueur qui lance). */
  remaining: number
  /** Place obtenue en terminant (1 = premier à finir), null tant qu'il n'a pas fini. */
  finishRank: number | null
  darts: number
  /** Points marqués (une volée « bust » compte 0). */
  points: number
  turns: number
}

/**
 * - playing : on saisit les fléchettes du joueur courant ;
 * - decision : un joueur vient de finir et au moins deux joueurs restent : continuer ou s'arrêter ;
 * - over : tout le monde a fini (le dernier est classé d'office) ;
 * - stopped : partie arrêtée avec au moins un joueur ayant fini (classement en l'état) ;
 * - cancelled : partie arrêtée sans qu'aucun joueur n'ait fini.
 */
export type GamePhase = 'playing' | 'decision' | 'over' | 'stopped' | 'cancelled'

export type GameState = {
  phase: GamePhase
  players: PlayerState[]
  current: number
  turnDarts: Dart[]
  finishedCount: number
  /** Dernière volée terminée (pour l'afficher : « Paul : 45 », « Bust ! »). */
  lastTurn: TurnSummary | null
  /** Joueur qui vient de finir (phase decision / over). */
  lastFinisher: number | null
}

export const MAX_PLAYERS = 10

export class GameError extends Error {}

export function initialState(config: GameConfig): GameState {
  if (config.players.length < 1 || config.players.length > MAX_PLAYERS) {
    throw new GameError(`Il faut entre 1 et ${MAX_PLAYERS} joueurs.`)
  }
  return {
    phase: 'playing',
    players: config.players.map(() => ({ remaining: config.start, finishRank: null, darts: 0, points: 0, turns: 0 })),
    current: 0,
    turnDarts: [],
    finishedCount: 0,
    lastTurn: null,
    lastFinisher: null,
  }
}

/** Score affiché du joueur : pour celui qui lance, on retire déjà les fléchettes de la volée. */
export function liveRemaining(state: GameState, index: number): number {
  const base = state.players[index].remaining
  if (index !== state.current || state.phase !== 'playing') return base
  return base - state.turnDarts.reduce((sum, d) => sum + dartValue(d), 0)
}

export function unfinishedCount(state: GameState): number {
  return state.players.filter((p) => p.finishRank === null).length
}

function nextUnfinished(players: PlayerState[], from: number): number {
  for (let step = 1; step <= players.length; step++) {
    const i = (from + step) % players.length
    if (players[i].finishRank === null) return i
  }
  return from
}

/** Une fléchette fait-elle « bust » ? (score restant avant la fléchette, fléchette) */
export function isBust(before: number, dart: Dart, doubleOut: boolean): boolean {
  const after = before - dartValue(dart)
  if (after < 0) return true
  if (!doubleOut) return false
  if (after === 1) return true
  return after === 0 && !isDouble(dart)
}

/** Applique un événement ; lève GameError s'il n'est pas permis dans l'état courant. */
export function applyEvent(config: GameConfig, state: GameState, event: GameEvent): GameState {
  if (event.type === 'stop') {
    if (state.phase !== 'playing' && state.phase !== 'decision') throw new GameError('La partie est déjà terminée.')
    const phase = state.finishedCount > 0 ? 'stopped' : 'cancelled'
    if (state.turnDarts.length === 0) return { ...state, phase }
    // Volée entamée : ses fléchettes comptent pour le classement en l'état.
    const partial = state.turnDarts.reduce((sum, d) => sum + dartValue(d), 0)
    const players = state.players.map((p, i) =>
      i === state.current
        ? { ...p, remaining: p.remaining - partial, points: p.points + partial, darts: p.darts + state.turnDarts.length }
        : p,
    )
    return { ...state, phase, players, turnDarts: [] }
  }
  if (event.type === 'continue') {
    if (state.phase !== 'decision') throw new GameError('Aucune décision en attente.')
    return { ...state, phase: 'playing' }
  }
  if (state.phase !== 'playing') throw new GameError('Saisie impossible : la partie attend une décision ou est terminée.')
  if (!isValidDart(event.dart)) throw new GameError('Fléchette invalide.')

  const before = liveRemaining(state, state.current)
  const turnDarts = [...state.turnDarts, event.dart]
  const bust = isBust(before, event.dart, config.doubleOut)
  const finished = !bust && before - dartValue(event.dart) === 0
  if (!bust && !finished && turnDarts.length < 3) return { ...state, turnDarts }

  // Fin de la volée
  const total = turnDarts.reduce((sum, d) => sum + dartValue(d), 0)
  const players = state.players.map((p) => ({ ...p }))
  const me = players[state.current]
  me.darts += turnDarts.length
  me.turns += 1
  let finishedCount = state.finishedCount
  if (!bust) {
    me.points += total
    me.remaining -= total
  }
  if (finished) {
    finishedCount += 1
    me.finishRank = finishedCount
  }
  const lastTurn: TurnSummary = { player: state.current, darts: turnDarts, total: bust ? 0 : total, bust, finished }
  const base = { ...state, players, turnDarts: [], finishedCount, lastTurn }

  if (!finished) return { ...base, current: nextUnfinished(players, state.current) }

  const left = players.filter((p) => p.finishRank === null).length
  if (left <= 1) {
    // Le dernier joueur restant prend la dernière place.
    const last = players.findIndex((p) => p.finishRank === null)
    if (last >= 0) players[last].finishRank = finishedCount + 1
    return { ...base, phase: 'over', lastFinisher: state.current }
  }
  return { ...base, phase: 'decision', lastFinisher: state.current, current: nextUnfinished(players, state.current) }
}

/** Rejoue toute la partie. Les événements invalides (ancienne sauvegarde abîmée) sont ignorés. */
export function replay(config: GameConfig, events: GameEvent[]): GameState {
  let state = initialState(config)
  for (const event of events) {
    try {
      state = applyEvent(config, state, event)
    } catch (e) {
      if (!(e instanceof GameError)) throw e
    }
  }
  return state
}

export function isGameEnded(phase: GamePhase): boolean {
  return phase === 'over' || phase === 'stopped' || phase === 'cancelled'
}

export type RankingRow = {
  index: number
  rank: number
  finished: boolean
  remaining: number
  darts: number
  points: number
  /** Moyenne sur 3 fléchettes, null si aucune fléchette lancée. */
  average: number | null
}

export function threeDartAverage(points: number, darts: number): number | null {
  return darts === 0 ? null : Math.round((points / darts) * 3 * 10) / 10
}

/**
 * Classement : ceux qui ont fini dans l'ordre d'arrivée, puis les autres au score restant
 * (le plus bas d'abord ; même score = même place).
 */
export function ranking(state: GameState): RankingRow[] {
  const rows = state.players.map((p, index) => ({
    index,
    rank: 0,
    finished: p.finishRank !== null,
    finishRank: p.finishRank,
    remaining: liveRemaining(state, index),
    darts: p.darts,
    points: p.points,
    average: threeDartAverage(p.points, p.darts),
  }))
  const done = rows.filter((r) => r.finishRank !== null).sort((a, b) => (a.finishRank ?? 0) - (b.finishRank ?? 0))
  // Le dernier classé d'office (partie « over ») a un finishRank mais n'a pas réellement fini.
  const sorted = [
    ...done,
    ...rows.filter((r) => r.finishRank === null).sort((a, b) => a.remaining - b.remaining || a.index - b.index),
  ]
  sorted.forEach((row, i) => {
    if (row.finishRank !== null) row.rank = row.finishRank
    else {
      const prev = sorted[i - 1]
      row.rank = prev && prev.finishRank === null && prev.remaining === row.remaining ? prev.rank : i + 1
    }
  })
  return sorted.map(({ finishRank: _finishRank, ...row }) => ({ ...row, finished: row.remaining === 0 }))
}
