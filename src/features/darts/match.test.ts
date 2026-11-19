import { describe, expect, it } from 'vitest'
import type { Dart } from './darts.ts'
import { replay, type GameEvent } from './engine.ts'
import {
  canUndo,
  createContextGame,
  legConfig,
  matchProgress,
  pushEvent,
  recordedLegs,
  startNextLeg,
  summarizeLegs,
  undoLast,
  type MatchContext,
} from './match.ts'
import type { SavedGame } from './storage.ts'

const T = (n: number): Dart => ({ segment: n, multiplier: 3 })
const S = (n: number): Dart => ({ segment: n, multiplier: 1 })
const D = (n: number): Dart => ({ segment: n, multiplier: 2 })

const match: MatchContext = {
  kind: 'match',
  tournamentId: 't',
  tournamentName: 'Fléchettes',
  label: 'Finale',
  matchId: 'm',
  legsToWin: 2,
  start: 301,
  doubleOut: false,
  players: [
    { playerId: 'home', name: 'Alice' },
    { playerId: 'away', name: 'Bob' },
  ],
}

function play(game: SavedGame, darts: Dart[]): SavedGame {
  let g = game
  for (const d of darts) {
    const next = pushEvent(g, { type: 'dart', dart: d })
    if (!next) throw new Error('fléchette refusée')
    g = next.game
  }
  return g
}

const ZERO = [S(0), S(0), S(0)]
/** 301 en 6 fléchettes pour le joueur qui commence (l'autre ne marque rien). */
const FIRST_WINS = [T(20), T(20), T(20), ...ZERO, T(20), T(20), S(1)]
/** Le second joueur gagne (le premier ne marque rien). */
const SECOND_WINS = [...ZERO, T(20), T(20), T(20), ...ZERO, T(20), T(20), S(1)]

describe('match de tournoi au compteur', () => {
  it('le joueur à domicile commence, puis on alterne à chaque manche', () => {
    expect(legConfig(match, 0).players.map((p) => p.key)).toEqual(['home', 'away'])
    expect(legConfig(match, 1).players.map((p) => p.key)).toEqual(['away', 'home'])
    expect(legConfig(match, 2).players.map((p) => p.key)).toEqual(['home', 'away'])
    const game = createContextGame(match)
    expect(game.config).toMatchObject({ start: 301, doubleOut: false })
    expect(game.participants.map((p) => p.ref)).toEqual([
      { kind: 'player', playerId: 'home' },
      { kind: 'player', playerId: 'away' },
    ])
  })

  it('manches successives jusqu’au nombre de manches gagnantes', () => {
    let game = play(createContextGame(match), FIRST_WINS)
    let p = matchProgress(game)
    expect(p.status).toBe('leg_over')
    expect(p.legsWon.get('home')).toBe(1)

    game = startNextLeg(game)
    expect(game.config.players[0].key).toBe('away')
    expect(matchProgress(game).status).toBe('playing')
    // Manche 2 : Bob commence et gagne.
    game = play(game, FIRST_WINS)
    p = matchProgress(game)
    expect([p.status, p.legsWon.get('home'), p.legsWon.get('away')]).toEqual(['leg_over', 1, 1])

    // Manche 3 : Alice commence ; Bob gagne en second.
    game = play(startNextLeg(game), SECOND_WINS)
    p = matchProgress(game)
    expect(p).toMatchObject({ status: 'match_over', winner: 'away' })
    expect(p.legsWon.get('away')).toBe(2)
  })

  it('1 manche gagnante : la première manche termine le match', () => {
    const game = play(createContextGame({ ...match, legsToWin: 1 }), FIRST_WINS)
    expect(matchProgress(game)).toMatchObject({ status: 'match_over', winner: 'home' })
  })

  it('annuler revient dans la manche précédente si la nouvelle n’a pas commencé', () => {
    const finished = play(createContextGame(match), FIRST_WINS)
    const next = startNextLeg(finished)
    expect(canUndo(next)).toBe(true)
    const back = undoLast(next)
    expect(back.previousLegs).toEqual([])
    expect(back.id).toBe(finished.id)
    expect(back.events).toHaveLength(FIRST_WINS.length - 1)
    expect(matchProgress(back).status).toBe('playing')
    expect(canUndo(createContextGame(match))).toBe(false)
  })

  it('sortie sur double : bust s’il reste 1, fin sur un double', () => {
    const ctx: MatchContext = { ...match, doubleOut: true, legsToWin: 1 }
    const bust = play(createContextGame(ctx), [T(20), T(20), T(20), ...ZERO, T(20), T(20)])
    const s = replay(bust.config, bust.events)
    expect(s.lastTurn?.bust).toBe(true)
    expect(s.players[0].remaining).toBe(121)
    expect(matchProgress(bust).status).toBe('playing')
    const done = play(createContextGame(ctx), [T(20), T(20), T(20), ...ZERO, T(19), S(4), S(20), ...ZERO, D(20)])
    expect(matchProgress(done)).toMatchObject({ status: 'match_over', winner: 'home' })
  })

  it('données envoyées à la base : une entrée par manche, joueurs dans l’ordre de jeu', () => {
    let game = play(createContextGame(match), FIRST_WINS)
    game = play(startNextLeg(game), SECOND_WINS)
    const legs = recordedLegs(game)
    expect(legs).toHaveLength(2)
    expect(legs[0].players).toEqual([
      { player_id: 'home', rank: 1, remaining: 0, darts: 6, points: 301 },
      { player_id: 'away', rank: 2, remaining: 301, darts: 3, points: 0 },
    ])
    expect(legs[1].players.map((p) => [p.player_id, p.rank])).toEqual([
      ['away', 2],
      ['home', 1],
    ])
    expect(new Set(legs.map((l) => l.game_id)).size).toBe(2)
  })
})

describe('départage de poule au compteur', () => {
  const tiebreak: MatchContext = {
    kind: 'tiebreak',
    tournamentId: 't',
    tournamentName: 'Fléchettes',
    label: 'Poule A',
    poolId: 'pool',
    start: 301,
    doubleOut: false,
    players: ['a', 'b', 'c'].map((id) => ({ playerId: id, name: id.toUpperCase() })),
  }

  it('ordre de jeu tiré au sort', () => {
    const game = createContextGame(tiebreak, () => 0)
    expect(game.config.players.map((p) => p.key)).toEqual(['b', 'c', 'a'])
  })

  it('jouée jusqu’au bout : pas de décision « continuer / s’arrêter »', () => {
    const order = ['a', 'b', 'c']
    let game = createContextGame({ ...tiebreak, players: order.map((id) => ({ playerId: id, name: id })) }, () => 0.99)
    expect(game.config.players.map((p) => p.key)).toEqual(order)
    // a finit en 6 fléchettes (b et c ne marquent rien).
    game = play(game, [T(20), T(20), T(20), ...ZERO, ...ZERO, T(20), T(20), S(1)])
    const state = replay(game.config, game.events)
    expect(state.phase).toBe('playing')
    expect(game.events.at(-1)).toEqual({ type: 'continue' } satisfies GameEvent)
    expect(matchProgress(game).status).toBe('playing')
    // Annuler retire la fléchette finale (et la poursuite automatique).
    expect(undoLast(game).events).toHaveLength(game.events.length - 2)
    // b finit : c est dernier d'office, départage terminé.
    game = play(game, [T(20), T(20), T(20), ...ZERO, T(20), T(20), S(1)])
    expect(matchProgress(game)).toMatchObject({ status: 'match_over', winner: 'a' })
    expect(recordedLegs(game)[0].players.map((p) => [p.player_id, p.rank])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })
})

describe('résumé des manches', () => {
  it('vainqueur, restes, fléchettes et moyenne sur le match', () => {
    const { lines, totals } = summarizeLegs([
      { players: [{ player_id: 'h', rank: 1, remaining: 0, darts: 9, points: 301 }, { player_id: 'a', rank: 2, remaining: 40, darts: 9, points: 261 }] },
      { players: [{ player_id: 'a', rank: 1, remaining: 0, darts: 12, points: 301 }, { player_id: 'h', rank: 2, remaining: 1, darts: 9, points: 300 }] },
    ])
    expect(lines.map((l) => [l.number, l.winner, l.remaining.get('a'), l.remaining.get('h')])).toEqual([
      [1, 'h', 40, 0],
      [2, 'a', 0, 1],
    ])
    expect(totals.find((t) => t.playerId === 'h')).toEqual({ playerId: 'h', darts: 18, points: 601, average: 100.2 })
  })
})
