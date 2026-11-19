import { describe, expect, it } from 'vitest'
import { dartLabel, dartValue, isValidDart, suggestCheckout, type Dart } from './darts.ts'
import { applyEvent, GameError, initialState, liveRemaining, ranking, replay, type GameConfig, type GameEvent } from './engine.ts'

const S = (n: number): Dart => ({ segment: n, multiplier: 1 })
const D = (n: number): Dart => ({ segment: n, multiplier: 2 })
const T = (n: number): Dart => ({ segment: n, multiplier: 3 })
const dart = (d: Dart): GameEvent => ({ type: 'dart', dart: d })
const labels = (darts: Dart[] | null) => darts?.map(dartLabel) ?? null

function config(n: number, start: 301 | 501 = 301, doubleOut = false): GameConfig {
  return { start, doubleOut, players: Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `Joueur ${i + 1}` })) }
}

describe('fléchettes', () => {
  it('valeurs et libellés', () => {
    expect(dartValue(T(20))).toBe(60)
    expect(dartValue(D(25))).toBe(50)
    expect(dartLabel(D(25))).toBe('Bull')
    expect(dartLabel(S(25))).toBe('25')
    expect(dartLabel(T(19))).toBe('T19')
    expect(isValidDart({ segment: 25, multiplier: 3 })).toBe(false)
    expect(isValidDart({ segment: 21, multiplier: 1 })).toBe(false)
    expect(isValidDart({ segment: 0, multiplier: 2 })).toBe(false)
  })
})

describe('finishs conseillés', () => {
  it('sortie sur double : classiques', () => {
    expect(labels(suggestCheckout(40, 3, true))).toEqual(['D20'])
    expect(labels(suggestCheckout(32, 1, true))).toEqual(['D16'])
    expect(labels(suggestCheckout(50, 1, true))).toEqual(['Bull'])
    expect(labels(suggestCheckout(100, 3, true))).toEqual(['T20', 'D20'])
    expect(labels(suggestCheckout(170, 3, true))).toEqual(['T20', 'T20', 'Bull'])
    expect(labels(suggestCheckout(41, 3, true))).toEqual(['1', 'D20'])
  })

  it('sortie sur double : impossibles', () => {
    for (const n of [1, 159, 162, 163, 165, 166, 168, 169, 171, 180]) expect(suggestCheckout(n, 3, true)).toBeNull()
    expect(suggestCheckout(100, 1, true)).toBeNull()
    expect(suggestCheckout(3, 1, true)).toBeNull()
    expect(labels(suggestCheckout(3, 2, true))).toEqual(['1', 'D1'])
  })

  it('sans double : le plus simple', () => {
    expect(labels(suggestCheckout(20, 3, false))).toEqual(['20'])
    expect(labels(suggestCheckout(57, 3, false))).toEqual(['T19'])
    expect(labels(suggestCheckout(180, 3, false))).toEqual(['T20', 'T20', 'T20'])
    expect(labels(suggestCheckout(1, 1, false))).toEqual(['1'])
    expect(suggestCheckout(181, 3, false)).toBeNull()
    expect(labels(suggestCheckout(61, 3, false))).toEqual(['T20', '1'])
  })

  it('chaque finish proposé termine exactement, en respectant la règle', () => {
    for (const doubleOut of [true, false]) {
      for (let n = 1; n <= 180; n++) {
        for (let left = 1; left <= 3; left++) {
          const c = suggestCheckout(n, left, doubleOut)
          if (!c) continue
          expect(c.length).toBeLessThanOrEqual(left)
          expect(c.reduce((s, d) => s + dartValue(d), 0)).toBe(n)
          if (doubleOut) expect(c[c.length - 1].multiplier).toBe(2)
        }
      }
    }
  })

  it('sans double, tout score de 1 à 180 a un finish en 3 fléchettes (sauf 163, 166, 169, 172+ non atteignables…)', () => {
    const impossible = Array.from({ length: 180 }, (_, i) => i + 1).filter((n) => !suggestCheckout(n, 3, false))
    expect(impossible).toEqual([163, 166, 169, 172, 173, 175, 176, 178, 179])
  })
})

describe('déroulement de la partie', () => {
  it('volées de 3 fléchettes et ordre de jeu', () => {
    const cfg = config(2)
    const s = replay(cfg, [dart(T(20)), dart(S(5)), dart(S(1))])
    expect(s.players[0].remaining).toBe(235)
    expect(s.current).toBe(1)
    expect(s.lastTurn).toMatchObject({ player: 0, total: 66, bust: false })
    const s2 = replay(cfg, [dart(T(20)), dart(S(5)), dart(S(1)), dart(S(20))])
    expect(liveRemaining(s2, 1)).toBe(281)
    expect(s2.players[1].remaining).toBe(301)
  })

  it('bust : dépassement, le score revient au début de la volée', () => {
    const cfg: GameConfig = { ...config(2), start: 301 }
    // Joueur 1 descend à 21 : 180 puis 100
    const zero = [dart(S(0)), dart(S(0)), dart(S(0))]
    const events = [dart(T(20)), dart(T(20)), dart(T(20)), ...zero, dart(T(20)), dart(S(20)), dart(S(20)), ...zero]
    let s = replay(cfg, events)
    expect(s.players[0].remaining).toBe(21)
    s = applyEvent(cfg, s, dart(S(20)))
    s = applyEvent(cfg, s, dart(S(5)))
    expect(s.lastTurn).toMatchObject({ bust: true, total: 0 })
    expect(s.players[0].remaining).toBe(21)
    expect(s.players[0].darts).toBe(8)
    expect(s.current).toBe(1)
  })

  it('sortie sur double : reste 1 ou fin sans double = bust ; fin sur Bull acceptée', () => {
    const cfg = config(2, 301, true)
    const zero = [dart(S(0)), dart(S(0)), dart(S(0))]
    const to50 = [dart(T(20)), dart(T(20)), dart(T(20)), ...zero, dart(T(20)), dart(S(11)), dart(S(0)), ...zero]
    const base = replay(cfg, to50)
    expect(base.players[0].remaining).toBe(50)
        let s = applyEvent(cfg, base, dart(S(25)))
    s = applyEvent(cfg, s, dart(S(25)))
    expect(s.lastTurn?.bust).toBe(true)
    s = applyEvent(cfg, base, dart(S(20)))
    s = applyEvent(cfg, s, dart(S(20)))
    s = applyEvent(cfg, s, dart(S(9)))
    expect(s.lastTurn?.bust).toBe(true) // reste 1
    s = applyEvent(cfg, base, dart(D(25)))
    expect(s.phase).toBe('over')
    expect(s.players[0].finishRank).toBe(1)
    expect(s.players[1].finishRank).toBe(2)
  })

  it('sans double : finir sur un simple ; dépasser = bust', () => {
    const cfg = config(1, 301)
    const s = replay(cfg, [dart(T(20)), dart(T(20)), dart(T(20)), dart(T(20)), dart(T(20)), dart(S(1))])
    expect(s.phase).toBe('over')
    expect(s.players[0]).toMatchObject({ finishRank: 1, darts: 6, points: 301 })
  })

  it('un joueur finit en milieu de volée : décision continuer / arrêter, puis classement', () => {
    const cfg = config(3, 301)
    const p1Finish = [dart(T(20)), dart(T(20)), dart(T(20)), dart(S(0)), dart(S(0)), dart(S(0)), dart(S(0)), dart(S(0)), dart(S(0)),
      dart(T(20)), dart(T(20)), dart(S(1))]
    let s = replay(cfg, p1Finish)
    expect(s.phase).toBe('decision')
    expect(s.lastFinisher).toBe(0)
    expect(s.current).toBe(1)
    expect(() => applyEvent(cfg, s, dart(S(20)))).toThrow(GameError)
    s = applyEvent(cfg, s, { type: 'continue' })
    expect(s.phase).toBe('playing')
    // Joueur 2 marque 60, joueur 3 marque 100, puis on arrête
    s = replay(cfg, [...p1Finish, { type: 'continue' }, dart(T(20)), dart(S(0)), dart(S(0)), dart(T(20)), dart(D(20)), dart(S(0)), { type: 'stop' }])
    expect(s.phase).toBe('stopped')
    const r = ranking(s)
    expect(r.map((x) => [x.index, x.rank])).toEqual([[0, 1], [2, 2], [1, 3]])
    // le tour revient au joueur 2 : le joueur 1 qui a fini est sauté
    expect(s.current).toBe(1)
  })

  it('arrêt en milieu de volée : les fléchettes déjà lancées comptent', () => {
    const s = replay(config(2), [dart(T(20)), dart(S(0)), dart(S(0)), dart(T(20)), { type: 'stop' }])
    expect(ranking(s).map((x) => [x.index, x.rank, x.remaining, x.darts])).toEqual([[0, 1, 241, 3], [1, 1, 241, 1]])
  })

  it('arrêt sans aucun joueur fini = partie annulée', () => {
    const s = replay(config(2), [dart(T(20)), { type: 'stop' }])
    expect(s.phase).toBe('cancelled')
  })

  it('ex aequo au score restant', () => {
    const zero = [dart(S(0)), dart(S(0)), dart(S(0))]
    const s180 = [dart(T(20)), dart(T(20)), dart(T(20))]
    const s = replay(config(4), [...s180, ...zero, ...zero, ...s180, { type: 'stop' }])
    expect(s.phase).toBe('cancelled')
    expect(ranking(s).map((x) => [x.index, x.rank])).toEqual([[0, 1], [3, 1], [1, 3], [2, 3]])
  })

  it('partie complète à 3 : le dernier est classé d\'office', () => {
    const cfg = config(3, 301)
    const finish = [dart(T(20)), dart(T(20)), dart(T(20)), dart(T(20)), dart(T(20)), dart(S(1))]
    const zero = [dart(S(0)), dart(S(0)), dart(S(0))]
    // J1 : 3 + 3 fléchettes, J2 idem, J3 rien
    const events: GameEvent[] = [...finish.slice(0, 3), ...zero, ...zero, ...finish.slice(3), { type: 'continue' }, ...finish.slice(0, 3), ...zero, ...finish.slice(3)]
    const s = replay(cfg, events)
    expect(s.phase).toBe('over')
    expect(ranking(s).map((x) => [x.index, x.rank, x.finished])).toEqual([[0, 1, true], [1, 2, true], [2, 3, false]])
  })

  it('moyenne sur 3 fléchettes', () => {
    const s = replay(config(2), [dart(T(20)), dart(T(20)), dart(S(20))])
    expect(ranking(s).find((r) => r.index === 0)?.average).toBe(140)
  })

  it('refuse plus de 10 joueurs ou aucun', () => {
    expect(() => initialState(config(11))).toThrow(GameError)
    expect(() => initialState(config(0))).toThrow(GameError)
  })
})
