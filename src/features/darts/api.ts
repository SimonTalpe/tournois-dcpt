import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import type { GameConfig, GameState } from './engine.ts'
import { ranking } from './engine.ts'

/** Participant d'une partie, tel que choisi dans la configuration. */
export type ParticipantRef =
  | { kind: 'account'; profileId: string }
  | { kind: 'name_only'; playerId: string }
  /** Joueur d'un match de tournoi (fiche joueur, compte ou nom seul). */
  | { kind: 'player'; playerId: string }
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
        : p.ref.kind === 'name_only' || p.ref.kind === 'player'
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

/** Manche ou partie au format attendu par la base (joueurs dans l'ordre de jeu). */
export type RecordedLeg = {
  game_id: string
  started_at: string
  players: { player_id: string; rank: number; remaining: number; darts: number; points: number }[]
}

/** Match de tournoi joué au compteur : manches + report du résultat dans le match. */
export async function recordDartMatch(matchId: string, legs: RecordedLeg[]): Promise<void> {
  if (!supabase) throw new DartsError("Le site n'est pas relié à la base de données.")
  const { error } = await supabase.rpc('record_dart_match', { p_match_id: matchId, p_legs: legs })
  if (error) throw new DartsError(translateError(error))
}

/** Départage de poule joué au compteur. */
export async function recordDartTiebreak(poolId: string, leg: RecordedLeg): Promise<void> {
  if (!supabase) throw new DartsError("Le site n'est pas relié à la base de données.")
  const { error } = await supabase.rpc('record_dart_tiebreak', {
    p_pool_id: poolId,
    p_game_id: leg.game_id,
    p_started_at: leg.started_at,
    p_players: leg.players,
  })
  if (error) throw new DartsError(translateError(error))
}

export type LegDetail = {
  leg_number: number
  players: { player_id: string; rank: number; finished: boolean; remaining: number; darts: number; points: number }[]
}

/** Manches d'un match joué au compteur (joueurs connectés uniquement ; vide sinon). */
export async function listMatchLegs(matchId: string): Promise<LegDetail[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('dart_games')
    .select('leg_number, players:dart_game_players(player_id, rank, finished, remaining, darts, points)')
    .eq('match_id', matchId)
    .order('leg_number')
  if (error) throw new DartsError(translateError(error))
  return (data ?? []) as LegDetail[]
}
