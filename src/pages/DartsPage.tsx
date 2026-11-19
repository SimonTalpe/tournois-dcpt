import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { recordDartGame, type Participant } from '../features/darts/api.ts'
import type { Dart } from '../features/darts/darts.ts'
import { applyEvent, GameError, isGameEnded, replay, type GameConfig, type GameEvent } from '../features/darts/engine.ts'
import { GameScreen } from '../features/darts/GameScreen.tsx'
import { ResultScreen, type SaveStatus } from '../features/darts/ResultScreen.tsx'
import { SetupScreen, type SetupValue } from '../features/darts/SetupScreen.tsx'
import { TournamentGame } from '../features/darts/TournamentGame.tsx'
import { loadSavedGame, newGameId, saveGame, type SavedGame } from '../features/darts/storage.ts'
import { useWakeLock, vibrate } from '../features/darts/useWakeLock.ts'
import { isSupabaseConfigured } from '../lib/supabase.ts'

function configOf(participants: Participant[], start: SetupValue['start'], doubleOut: boolean): GameConfig {
  return { start, doubleOut, players: participants.map((p) => ({ key: p.key, name: p.name })) }
}

function newGame(value: SetupValue, local: boolean): SavedGame {
  return {
    version: 1,
    id: newGameId(),
    local,
    config: configOf(value.participants, value.start, value.doubleOut),
    participants: value.participants,
    events: [],
    startedAt: new Date().toISOString(),
    recorded: false,
  }
}

/** Onglet « Compteur » : configuration, partie, résultat. La partie vit sur l'appareil. */
export function DartsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const local = !isSupabaseConfigured || auth.demoMode || !isPlayer(auth)
  const [game, setGame] = useState<SavedGame | null>(() => loadSavedGame())
  const [setup, setSetup] = useState<SetupValue>(() => ({
    participants:
      !local && auth.profile
        ? [{ key: newGameId(), name: auth.profile.full_name, ref: { kind: 'account', profileId: auth.profile.id } }]
        : [],
    start: 301,
    doubleOut: false,
  }))
  const [saving, setSaving] = useState<{ kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })

  const state = useMemo(() => (game ? replay(game.config, game.events) : null), [game])
  const playing = state !== null && !isGameEnded(state.phase)
  useWakeLock(playing)

  useEffect(() => {
    saveGame(game)
  }, [game])

  const pushEvent = useCallback(
    (event: GameEvent) => {
      if (!game || !state) return
      try {
        const next = applyEvent(game.config, state, event)
        if (event.type === 'dart' && next.lastTurn !== state.lastTurn && next.lastTurn) {
          if (next.lastTurn.finished) vibrate([60, 40, 160])
          else if (next.lastTurn.bust) vibrate([90, 50, 90])
        }
      } catch (e) {
        if (e instanceof GameError) return
        throw e
      }
      setGame({ ...game, events: [...game.events, event] })
    },
    [game, state],
  )

  const undo = useCallback(() => {
    if (!game || game.events.length === 0 || game.recorded) return
    setSaving({ kind: 'idle' })
    setGame({ ...game, events: game.events.slice(0, -1) })
  }, [game])

  async function handleSave() {
    if (!game || !state || game.local) return
    setSaving({ kind: 'saving' })
    try {
      await recordDartGame({
        id: game.id,
        config: game.config,
        participants: game.participants,
        state,
        startedAt: game.startedAt,
      })
      setSaving({ kind: 'idle' })
      setGame({ ...game, recorded: true })
    } catch (e) {
      setSaving({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  function backToSetup(g: SavedGame) {
    setSetup({ participants: g.participants, start: g.config.start, doubleOut: g.config.doubleOut })
    setSaving({ kind: 'idle' })
    setGame(null)
  }

  // Partie lancée depuis un match ou un départage de tournoi.
  if (game?.context) {
    return (
      <TournamentGame
        game={game}
        onChange={setGame}
        onLeave={(path) => {
          // Effacée tout de suite : la page est quittée avant l'enregistrement automatique.
          saveGame(null)
          setGame(null)
          navigate(path)
        }}
      />
    )
  }

  if (!game || !state) {
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-bold text-court">🎯 Compteur de fléchettes</h1>
        <SetupScreen
          local={local}
          initial={setup}
          onLaunch={(value) => {
            setSetup(value)
            setSaving({ kind: 'idle' })
            setGame(newGame(value, local))
          }}
        />
      </section>
    )
  }

  if (isGameEnded(state.phase)) {
    const save: SaveStatus = game.local ? { kind: 'local' } : game.recorded ? { kind: 'saved' } : saving
    return (
      <section>
        <ResultScreen
          config={game.config}
          state={state}
          save={save}
          onSave={handleSave}
          onUndo={undo}
          onRematch={() => {
            setSaving({ kind: 'idle' })
            setGame(
              newGame({ participants: game.participants, start: game.config.start, doubleOut: game.config.doubleOut }, game.local),
            )
          }}
          onNewGame={() => backToSetup(game)}
        />
      </section>
    )
  }

  return (
    <section>
      <h1 className="sr-only">Compteur de fléchettes — partie en cours</h1>
      <GameScreen
        config={game.config}
        state={state}
        canUndo={game.events.length > 0}
        onDart={(dart: Dart) => pushEvent({ type: 'dart', dart })}
        onUndo={undo}
        onContinue={() => pushEvent({ type: 'continue' })}
        onStop={() => pushEvent({ type: 'stop' })}
      />
    </section>
  )
}
