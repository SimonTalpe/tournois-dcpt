import type { BracketKind } from '../../lib/draw/types.ts'
import type { SetScore } from '../../lib/scores.ts'

export type Discipline = 'mini_pong' | 'darts'
export type TournamentFormat = 'knockout' | 'pools_knockout'
export type TournamentStatus = 'draft' | 'in_progress' | 'finished' | 'archived'
export type QualifierPlacement = 'classic' | 'random'
export type MatchStatus = 'pending' | 'bye' | 'played' | 'walkover' | 'cancelled'

export type Tournament = {
  id: string
  name: string
  description: string
  discipline: Discipline
  format: TournamentFormat
  status: TournamentStatus
  pool_count: number | null
  qualifiers_per_pool: number | null
  qualifier_placement: QualifierPlacement
  third_place: boolean
  consolation: boolean
  default_sets_to_win: number
  default_dart_start: number
  launched_at: string | null
  created_at: string
}

/** Champs modifiables par l'admin (création / configuration). */
export type TournamentInput = Pick<
  Tournament,
  | 'name'
  | 'description'
  | 'discipline'
  | 'format'
  | 'pool_count'
  | 'qualifiers_per_pool'
  | 'qualifier_placement'
  | 'third_place'
  | 'consolation'
  | 'default_sets_to_win'
  | 'default_dart_start'
>

/** Valeurs proposées à la création d'un tournoi. */
export const EMPTY_TOURNAMENT: TournamentInput = {
  name: '',
  description: '',
  discipline: 'mini_pong',
  format: 'knockout',
  pool_count: null,
  qualifiers_per_pool: null,
  qualifier_placement: 'classic',
  third_place: true,
  consolation: false,
  default_sets_to_win: 2,
  default_dart_start: 301,
}

export type Player = { id: string; profile_id: string | null; full_name: string }

export type Entry = { tournament_id: string; player_id: string; pool_id: string | null }

export type Pool = { id: string; tournament_id: string; label: string }

export type Round = {
  id: string
  tournament_id: string
  bracket: BracketKind
  round_number: number
  name: string
  sets_to_win: number
  dart_start: number
}

export type Match = {
  id: string
  tournament_id: string
  round_id: string
  pool_id: string | null
  position: number
  home_player_id: string | null
  away_player_id: string | null
  winner_player_id: string | null
  status: MatchStatus
  next_match_id: string | null
  next_slot: 'home' | 'away' | null
  loser_next_match_id: string | null
  loser_next_slot: 'home' | 'away' | null
  /** Auteur du résultat (profil), saisi par l'admin ?, 1re saisie et dernière modification. */
  result_by: string | null
  result_by_admin: boolean
  result_first_at: string | null
  result_at: string | null
}

/** Tout ce qu'il faut pour afficher un tournoi. */
export type TournamentBundle = {
  tournament: Tournament
  entries: Entry[]
  players: Map<string, Player>
  pools: Pool[]
  rounds: Round[]
  matches: Match[]
  /** Scores des sets (mini-pong), par match, dans l'ordre. */
  sets: Map<string, SetScore[]>
  /** Noms des auteurs des résultats (non lisibles par les spectateurs). */
  authors: Map<string, string>
}

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  mini_pong: 'Mini-pong',
  darts: 'Fléchettes',
}

export const DISCIPLINE_ICONS: Record<Discipline, string> = {
  mini_pong: '🏓',
  darts: '🎯',
}

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  finished: 'Terminé',
  archived: 'Archivé',
}

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  knockout: 'Élimination directe',
  pools_knockout: 'Poules puis élimination directe',
}

/** Format de jeu d'un tour, en clair. */
export function gameFormatLabel(discipline: Discipline, round: Pick<Round, 'sets_to_win' | 'dart_start'>): string {
  if (discipline === 'darts') return `${round.dart_start}`
  return round.sets_to_win === 1 ? '1 set gagnant' : `${round.sets_to_win} sets gagnants`
}
