import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import type { GameConfig, GameState } from './engine.ts'
import { ranking } from './engine.ts'

/** Participant d'une partie, tel que choisi dans la configuration. */
export type ParticipantRef =
  | { kind: 'account'; profileId: string }
  | { kind: 'name_only'; playerId: string }
  /** Nouveau joueur sans compte : créé comme « nom seul » à l'enregistrement. */
  | { kind: 'new' }
  /** Mode local (spectateur) : simple nom, rien n'est enregistré. */
  | { kind: 'guest' }

export type Participant = { key: string; name: string; ref: ParticipantRef }

export type DartPerson = { kind: 'account' | 'name_only'; id: string; full_name: string }

export class DartsError extends Error {}

export async function listDartPeople(): Promise<DartPerson[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('dart_list_people')
  if (error) throw new DartsError(translateError(error))
  return (data ?? []) as DartPerson[]
}

/** Enregistre le résultat final (partie terminée ou arrêtée avec au moins un joueur ayant fini). */
export async function recordDartGame(input: {
  id: string
  config: GameConfig
  participants: Participant[]
  state: GameState
  startedAt: string
}): Promise<void> {
  if (!supabase) throw new DartsError("Le site n'est pas relié à la base de données.")
  const { id, config, participants, state, startedAt } = input
  if (state.phase !== 'over' && state.phase !== 'stopped') throw new DartsError('La partie n’est pas terminée.')
  const rows = new Map(ranking(state).map((r) => [r.index, r]))
  const payload = participants.map((p, index) => {
    const row = rows.get(index)
    if (!row) throw new DartsError('Classement incomplet.')
    const identity =
      p.ref.kind === 'account'
        ? { profile_id: p.ref.profileId }
        : p.ref.kind === 'name_only'
          ? { player_id: p.ref.playerId }
          : { new_name: p.name }
    return { ...identity, rank: row.rank, remaining: row.remaining, darts: row.darts, points: row.points }
  })
  const { error } = await supabase.rpc('record_dart_game', {
    p_game_id: id,
    p_start_score: config.start,
    p_double_out: config.doubleOut,
    p_status: state.phase === 'over' ? 'finished' : 'stopped',
    p_started_at: startedAt,
    p_participants: payload,
  })
  if (error) throw new DartsError(translateError(error))
}
