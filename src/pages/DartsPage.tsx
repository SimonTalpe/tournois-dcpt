import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isAdmin, isPlayer, useAuth } from '../features/auth/AuthContext.ts'
import { recordDartGame, type Participant } from '../features/darts/api.ts'
import { rankedEligible } from '../features/darts/setup.ts'
import { recordRankedDartGame } from '../features/ranking/api.ts'
import type { Dart } from '../features/darts/darts.ts'
import { applyEvent, GameError, isGameEnded, ranking, replay, type GameConfig, type GameEvent } from '../features/darts/engine.ts'
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
    ranked: value.ranked,
  }
}

/** Onglet « Compteur » : configuration, partie, résultat. La partie vit sur l'appareil. */
export function DartsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const local = !isSupabaseConfigured || auth.demoMode || !isPlayer(auth)
  const viewer = { profileId: auth.profile?.id ?? null, isAdmin: isAdmin(auth) }
  /** Arrivée depuis le leaderboard des fléchettes : match classé pré-rempli (301, sortie simple, moi + adversaire). */
  const rankedSetup = !local && Boolean((location.state as { rankedSetup?: boolean } | null)?.rankedSetup)
  const [game, setGame] = useState<SavedGame | null>(() => {
    const saved = loadSavedGame()
    return rankedSetup && saved && (saved.recorded || isGameEnded(replay(saved.config, saved.events).phase)) && !saved.context
      ? null
      : saved
  })
  const [setup, setSetup] = useState<SetupValue>(() => ({
    participants:
      !local && auth.profile
        ? [{ key: newGameId(), name: auth.profile.full_name, ref: { kind: 'account', profileId: auth.profile.id } }]
        : [],
    start: 301,
    doubleOut: false,
    ranked: rankedSetup,
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

  async function handleSave(asRanked = Boolean(game?.ranked)) {
    if (!game || !state || game.local) return
    setSaving({ kind: 'saving' })
    try {
      if (asRanked) {
        const rows = new Map(ranking(state).map((r) => [r.index, r]))
        const players = game.participants.map((p, index) => {
          const row = rows.get(index)
          if (!row || p.ref.kind !== 'account') throw new Error('Match classé : deux joueurs avec compte attendus.')
          return { profile_id: p.ref.profileId, rank: row.rank, remaining: row.remaining, darts: row.darts, points: row.points }
        })
        const deltas = await recordRankedDartGame({ gameId: game.id, startedAt: game.startedAt, players })
        // Domicile = joueur qui tient le compteur (sinon le 1er dans l'ordre de jeu).
        const me = auth.profile?.id
        const [home, away] = players[1].profile_id === me ? [players[1], players[0]] : [players[0], players[1]]
        const eloDeltas = [
          { profileId: home.profile_id, delta: deltas.home_delta ?? 0 },
          { profileId: away.profile_id, delta: deltas.away_delta ?? 0 },
        ]
        setSaving({ kind: 'idle' })
        setGame({ ...game, recorded: true, ranked: true, eloDeltas })
        return
      }
      await recordDartGame({
        id: game.id,
        config: game.config,
        participants: game.participants,
        state,
        startedAt: game.startedAt,
      })
      setSaving({ kind: 'idle' })
      setGame({ ...game, recorded: true, ranked: false })
    } catch (e) {
      setSaving({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  function backToSetup(g: SavedGame) {
    setSetup({ participants: g.participants, start: g.config.start, doubleOut: g.config.doubleOut, ranked: Boolean(g.ranked) })
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
        <h1 className="font-display text-[56px] leading-[0.9] font-black sm:text-[72px]">Compteur de fléchettes</h1>
        <SetupScreen
          key={setup.ranked ? 'ranked' : 'free'}
          viewer={viewer}
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
          ranked={Boolean(game.ranked)}
          eloDeltas={game.eloDeltas?.map((d) => ({
            name: game.participants.find((p) => p.ref.kind === 'account' && p.ref.profileId === d.profileId)?.name ?? '',
            delta: d.delta,
          }))}
          onSave={() => void handleSave()}
          onSaveUnranked={() => void handleSave(false)}
          onUndo={undo}
          onRematch={() => {
            setSaving({ kind: 'idle' })
            setGame(
              newGame(
                {
                  participants: game.participants,
                  start: game.config.start,
                  doubleOut: game.config.doubleOut,
                  ranked: Boolean(game.ranked) && rankedEligible(game.participants, game.config.start, game.config.doubleOut, viewer),
                },
                game.local,
              ),
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
