import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSavedGame, saveGame, setGameOwner, type SavedGame } from './storage.ts'

// Stockage du navigateur simulé (les tests tournent sous Node).
const store = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const game: SavedGame = {
  version: 1,
  id: 'g1',
  local: false,
  config: { start: 301, doubleOut: false, players: 2 } as unknown as SavedGame['config'],
  participants: [],
  events: [],
  startedAt: '2026-11-26T20:00:00.000Z',
  recorded: false,
}

describe('partie sauvegardée sur l’appareil', () => {
  afterEach(() => {
    store.clear()
    setGameOwner(null)
  })

  it('est retrouvée par le même compte', () => {
    setGameOwner('alice')
    saveGame(game)
    expect(loadSavedGame()?.id).toBe('g1')
  })

  it('est ignorée par un autre compte ou un spectateur', () => {
    setGameOwner('alice')
    saveGame(game)
    setGameOwner('bob')
    expect(loadSavedGame()).toBeNull()
    setGameOwner(null)
    expect(loadSavedGame()).toBeNull()
  })
})
