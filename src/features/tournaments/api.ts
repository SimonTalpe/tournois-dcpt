import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLaunchDraw, type DrawConfig, type DrawResult } from '../../lib/draw/plan.ts'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import type {
  Entry,
  Match,
  Player,
  Pool,
  Round,
  Tournament,
  TournamentBundle,
  TournamentInput,
  TournamentStatus,
} from './types.ts'

/** Erreur déjà traduite en français, prête à afficher. */
export class TournamentError extends Error {}

function db(): SupabaseClient {
  if (!supabase) throw new TournamentError("Le site n'est pas relié à la base de données.")
  return supabase
}

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new TournamentError(translateError(result.error))
  return result.data
}

const TOURNAMENT_COLUMNS =
  'id, name, description, discipline, format, status, pool_count, qualifiers_per_pool, qualifier_placement, third_place, consolation, default_sets_to_win, default_dart_start, launched_at, created_at'

export async function listTournaments(): Promise<Tournament[]> {
  return check(await db().from('tournaments').select(TOURNAMENT_COLUMNS).order('created_at', { ascending: false })) as Tournament[]
}

export async function loadTournament(id: string): Promise<TournamentBundle | null> {
  const client = db()
  const tournament = check(await client.from('tournaments').select(TOURNAMENT_COLUMNS).eq('id', id).maybeSingle()) as Tournament | null
  if (!tournament) return null
  const [entries, pools, rounds, matches] = await Promise.all([
    client.from('tournament_entries').select('tournament_id, player_id, pool_id').eq('tournament_id', id),
    client.from('pools').select('id, tournament_id, label').eq('tournament_id', id).order('label'),
    client
      .from('tournament_rounds')
      .select('id, tournament_id, bracket, round_number, name, sets_to_win, dart_start')
      .eq('tournament_id', id),
    client
      .from('matches')
      .select(
        'id, tournament_id, round_id, pool_id, position, home_player_id, away_player_id, winner_player_id, status, next_match_id, next_slot, loser_next_match_id, loser_next_slot',
      )
      .eq('tournament_id', id)
      .order('position'),
  ])
  const entryRows = check(entries) as Entry[]
  const matchRows = check(matches) as Match[]
  const playerIds = new Set<string>(entryRows.map((e) => e.player_id))
  for (const m of matchRows) {
    for (const p of [m.home_player_id, m.away_player_id, m.winner_player_id]) if (p) playerIds.add(p)
  }
  const players = playerIds.size
    ? (check(await client.from('players').select('id, profile_id, full_name').in('id', [...playerIds])) as Player[])
    : []
  return {
    tournament,
    entries: entryRows,
    players: new Map(players.map((p) => [p.id, p])),
    pools: check(pools) as Pool[],
    rounds: check(rounds) as Round[],
    matches: matchRows,
  }
}

const INPUT_FIELDS = [
  'name',
  'description',
  'discipline',
  'format',
  'pool_count',
  'qualifiers_per_pool',
  'qualifier_placement',
  'third_place',
  'consolation',
  'default_sets_to_win',
  'default_dart_start',
] as const satisfies readonly (keyof TournamentInput)[]

/**
 * Ne garde que les champs modifiables par l'admin. Le formulaire est prérempli avec la ligne complète
 * du tournoi (id, statut, dates…) : envoyer ces colonnes ferait refuser l'enregistrement par la base.
 * Champs propres à la structure omis si `structureLocked` (tournoi lancé).
 */
export function pickTournamentInput(
  source: Partial<TournamentInput> & Record<string, unknown>,
  structureLocked = false,
): Partial<TournamentInput> {
  const locked = new Set(['discipline', 'format', 'pool_count', 'qualifiers_per_pool', 'third_place', 'consolation'])
  const result: Record<string, unknown> = {}
  for (const field of INPUT_FIELDS) {
    if (structureLocked && locked.has(field)) continue
    if (field in source) result[field] = source[field]
  }
  return result as Partial<TournamentInput>
}

export async function createTournament(input: TournamentInput): Promise<string> {
  const row = check(await db().from('tournaments').insert(pickTournamentInput(input)).select('id').single()) as {
    id: string
  }
  return row.id
}

export async function updateTournament(
  id: string,
  input: Partial<TournamentInput>,
  structureLocked = false,
): Promise<void> {
  check(await db().from('tournaments').update(pickTournamentInput(input, structureLocked)).eq('id', id))
}

export async function deleteTournament(id: string): Promise<void> {
  check(await db().from('tournaments').delete().eq('id', id))
}

// ---------------------------------------------------------------- Participants

/** Comptes actifs (pour l'inscription) et participants existants. */
export async function listSelectablePeople(): Promise<{
  accounts: { id: string; full_name: string }[]
  players: Player[]
}> {
  const client = db()
  const [accounts, players] = await Promise.all([
    client.from('profiles').select('id, full_name').eq('status', 'active').order('full_name'),
    client.from('players').select('id, profile_id, full_name').order('full_name'),
  ])
  return {
    accounts: check(accounts) as { id: string; full_name: string }[],
    players: check(players) as Player[],
  }
}

/** Participant lié à un compte (créé au besoin). */
export async function playerForAccount(profileId: string): Promise<string> {
  const client = db()
  const existing = check(await client.from('players').select('id').eq('profile_id', profileId).maybeSingle()) as {
    id: string
  } | null
  if (existing) return existing.id
  // Le nom est recopié du profil par la base.
  const row = check(
    await client.from('players').insert({ profile_id: profileId, full_name: '--' }).select('id').single(),
  ) as { id: string }
  return row.id
}

export async function createNameOnlyPlayer(fullName: string): Promise<string> {
  const row = check(await db().from('players').insert({ full_name: fullName.trim() }).select('id').single()) as {
    id: string
  }
  return row.id
}

export async function addEntry(tournamentId: string, playerId: string): Promise<void> {
  const result = await db().from('tournament_entries').insert({ tournament_id: tournamentId, player_id: playerId })
  if (result.error?.code === '23505') throw new TournamentError('Ce joueur est déjà inscrit.')
  check(result)
}

export async function removeEntry(tournamentId: string, playerId: string): Promise<void> {
  check(await db().from('tournament_entries').delete().eq('tournament_id', tournamentId).eq('player_id', playerId))
}

// ---------------------------------------------------------------- Tirage et cycle de vie

export function drawConfigOf(t: Tournament): DrawConfig {
  return {
    format: t.format,
    poolCount: t.pool_count,
    qualifiersPerPool: t.qualifiers_per_pool,
    thirdPlace: t.third_place,
    consolation: t.consolation,
  }
}

/** Calcule un tirage pour les inscrits actuels (sans l'enregistrer). */
export function computeDraw(bundle: TournamentBundle): DrawResult {
  return buildLaunchDraw(
    bundle.entries.map((e) => e.player_id),
    drawConfigOf(bundle.tournament),
  )
}

/** Enregistre le tirage (lancement, ou nouveau tirage tant qu'aucun match n'est joué). */
export async function launchTournament(id: string, draw: DrawResult): Promise<void> {
  check(await db().rpc('admin_launch_tournament', { p_tournament_id: id, p_plan: draw.plan }))
}

export async function resetTournament(id: string): Promise<void> {
  check(await db().rpc('admin_reset_tournament', { p_tournament_id: id }))
}

export async function replacePlayer(tournamentId: string, oldPlayerId: string, newPlayerId: string): Promise<void> {
  check(
    await db().rpc('admin_replace_player', {
      p_tournament_id: tournamentId,
      p_old_player_id: oldPlayerId,
      p_new_player_id: newPlayerId,
    }),
  )
}

export async function setTournamentStatus(id: string, status: TournamentStatus): Promise<void> {
  check(await db().rpc('admin_set_tournament_status', { p_tournament_id: id, p_status: status }))
}

export async function updateRoundFormat(
  roundId: string,
  format: Pick<Round, 'sets_to_win' | 'dart_start'>,
): Promise<void> {
  check(await db().from('tournament_rounds').update(format).eq('id', roundId))
}
