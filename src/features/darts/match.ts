/**
 * Compteur de fléchettes lancé depuis un tournoi : match en une ou plusieurs manches
 * (le joueur à domicile commence la 1re manche, puis on alterne), ou départage de poule
 * (partie à plusieurs, ordre tiré au sort, jouée jusqu'au bout).
 *
 * Tout est recalculé à partir de la partie sauvegardée sur l'appareil (manches jouées + manche en cours).
 */
import type { RecordedLeg } from './api.ts'
import { applyEvent, ranking, replay, threeDartAverage, type GameConfig, type GameEvent, type GameMode, type GameState } from './engine.ts'
import { shuffled } from './setup.ts'
import { newGameId, type PlayedLeg, type SavedGame } from './storage.ts'

export type ContextPlayer = { playerId: string; name: string }

type ContextBase = {
  tournamentId: string
  tournamentName: string
  /** Ex. « Poule A », « Demi-finales · M5 ». */
  label: string
  start: GameMode
  doubleOut: boolean
}

export type MatchContext =
  | (ContextBase & {
      kind: 'match'
      matchId: string
      /** Manches gagnantes (1 à 3). */
      legsToWin: number
      /** Domicile, extérieur. */
      players: [ContextPlayer, ContextPlayer]
    })
  | (ContextBase & {
      kind: 'tiebreak'
      poolId: string
      /** Ordre de jeu (tiré au sort). */
      players: ContextPlayer[]
    })

/** Joueurs d'une manche dans l'ordre de jeu : en match, le joueur qui commence alterne. */
export function legConfig(context: MatchContext, legIndex: number): GameConfig {
  const players =
    context.kind === 'match' && legIndex % 2 === 1 ? [context.players[1], context.players[0]] : context.players
  return {
    start: context.start,
    doubleOut: context.doubleOut,
    players: players.map((p) => ({ key: p.playerId, name: p.name })),
  }
}

/** Nouvelle partie de tournoi (départage : ordre de jeu tiré au sort). */
export function createContextGame(context: MatchContext, random: () => number = Math.random): SavedGame {
  const ctx: MatchContext = context.kind === 'tiebreak' ? { ...context, players: shuffled(context.players, random) } : context
  const config = legConfig(ctx, 0)
  return {
    version: 1,
    id: newGameId(),
    local: false,
    config,
    participants: ctx.players.map((p) => ({ key: p.playerId, name: p.name, ref: { kind: 'player', playerId: p.playerId } })),
    events: [],
    startedAt: new Date().toISOString(),
    recorded: false,
    context: ctx,
    previousLegs: [],
  }
}

function currentLeg(game: SavedGame): PlayedLeg {
  return { id: game.id, config: game.config, events: game.events, startedAt: game.startedAt }
}

/** Toutes les manches (jouées + en cours). */
export function allLegs(game: SavedGame): PlayedLeg[] {
  return [...(game.previousLegs ?? []), currentLeg(game)]
}

/** Vainqueur d'une manche terminée (clé = identifiant du joueur), sinon null. */
export function legWinner(leg: PlayedLeg): string | null {
  const state = replay(leg.config, leg.events)
  if (state.phase !== 'over') return null
  const first = ranking(state).find((r) => r.rank === 1 && r.finished)
  return first ? leg.config.players[first.index].key : null
}

export type MatchProgress = {
  /** Manches gagnées par joueur (identifiant → nombre). */
  legsWon: Map<string, number>
  /** Vainqueur du match, s'il est décidé. */
  winner: string | null
  /**
   * - playing : la manche en cours se joue ;
   * - leg_over : manche finie, match pas encore décidé (manche suivante à lancer) ;
   * - match_over : match (ou départage) terminé, résultat à valider.
   */
  status: 'playing' | 'leg_over' | 'match_over'
}

export function matchProgress(game: SavedGame): MatchProgress {
  const context = game.context
  const legsWon = new Map<string, number>((context?.players ?? []).map((p) => [p.playerId, 0]))
  for (const leg of allLegs(game)) {
    const w = legWinner(leg)
    if (w) legsWon.set(w, (legsWon.get(w) ?? 0) + 1)
  }
  const currentOver = replay(game.config, game.events).phase === 'over'
  if (!context || context.kind === 'tiebreak') {
    return { legsWon, winner: currentOver ? legWinner(currentLeg(game)) : null, status: currentOver ? 'match_over' : 'playing' }
  }
  const winner = [...legsWon].find(([, n]) => n >= context.legsToWin)?.[0] ?? null
  return { legsWon, winner, status: winner ? 'match_over' : currentOver ? 'leg_over' : 'playing' }
}

/** Lance la manche suivante (le joueur qui commence alterne). */
export function startNextLeg(game: SavedGame, now: Date = new Date()): SavedGame {
  if (!game.context || game.context.kind !== 'match') return game
  const previousLegs = [...(game.previousLegs ?? []), currentLeg(game)]
  return {
    ...game,
    previousLegs,
    id: newGameId(),
    config: legConfig(game.context, previousLegs.length),
    events: [],
    startedAt: now.toISOString(),
  }
}

/**
 * Ajoute un événement. En tournoi, pas de « s'arrêter là » : quand un joueur finit et qu'il en reste
 * au moins deux, la partie continue d'office (classement complet).
 * Renvoie null si l'événement n'est pas permis.
 */
export function pushEvent(game: SavedGame, event: GameEvent): { game: SavedGame; state: GameState; previous: GameState } | null {
  const previous = replay(game.config, game.events)
  let state: GameState
  try {
    state = applyEvent(game.config, previous, event)
  } catch {
    return null
  }
  const events = [...game.events, event]
  if (game.context && state.phase === 'decision') {
    state = applyEvent(game.config, state, { type: 'continue' })
    events.push({ type: 'continue' })
  }
  return { game: { ...game, events }, state, previous }
}

/** Annule la dernière fléchette, y compris celle qui a terminé la manche précédente. */
export function undoLast(game: SavedGame): SavedGame {
  if (game.events.length === 0) {
    const previousLegs = [...(game.previousLegs ?? [])]
    const leg = previousLegs.pop()
    if (!leg) return game
    return undoLast({ ...game, previousLegs, id: leg.id, config: leg.config, events: leg.events, startedAt: leg.startedAt })
  }
  let events = game.events.slice(0, -1)
  // « Continuer » ajouté d'office : on retire aussi la fléchette qui l'a déclenché.
  if (game.context && game.events[game.events.length - 1].type === 'continue') events = events.slice(0, -1)
  return { ...game, events }
}

export function canUndo(game: SavedGame): boolean {
  return game.events.length > 0 || (game.previousLegs?.length ?? 0) > 0
}

/** Manches au format de la base (match terminé ou départage terminé). */
export function recordedLegs(game: SavedGame): RecordedLeg[] {
  return allLegs(game).map((leg) => {
    const rows = new Map(ranking(replay(leg.config, leg.events)).map((r) => [r.index, r]))
    return {
      game_id: leg.id,
      started_at: leg.startedAt,
      players: leg.config.players.map((p, index) => {
        const row = rows.get(index)
        if (!row) throw new Error('Classement incomplet.')
        return { player_id: p.key, rank: row.rank, remaining: row.remaining, darts: row.darts, points: row.points }
      }),
    }
  })
}

export type LegLine = {
  number: number
  winner: string | null
  /** Reste de chaque joueur (identifiant → points restants). */
  remaining: Map<string, number>
}

export type PlayerTotals = { playerId: string; darts: number; points: number; average: number | null }

/** Résumé des manches : vainqueur et restes par manche, fléchettes et moyenne par joueur sur le match. */
export function summarizeLegs(
  legs: { players: { player_id: string; rank: number; remaining: number; darts: number; points: number }[] }[],
): { lines: LegLine[]; totals: PlayerTotals[] } {
  const totals = new Map<string, { darts: number; points: number }>()
  const lines = legs.map((leg, i) => {
    for (const p of leg.players) {
      const t = totals.get(p.player_id) ?? { darts: 0, points: 0 }
      totals.set(p.player_id, { darts: t.darts + p.darts, points: t.points + p.points })
    }
    return {
      number: i + 1,
      winner: leg.players.find((p) => p.rank === 1 && p.remaining === 0)?.player_id ?? null,
      remaining: new Map(leg.players.map((p) => [p.player_id, p.remaining])),
    }
  })
  return {
    lines,
    totals: [...totals].map(([playerId, t]) => ({ playerId, ...t, average: threeDartAverage(t.points, t.darts) })),
  }
}
