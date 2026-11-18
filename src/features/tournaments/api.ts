import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLaunchDraw, type DrawConfig, type DrawResult } from '../../lib/draw/plan.ts'
import type { SetScore } from '../../lib/scores.ts'
import { supabase } from '../../lib/supabase.ts'
import { translateError } from '../auth/errors.ts'
import type {
  Entry,
  Location,
  Match,
  Player,
  Pool,
  PoolTiebreak,
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
  const [entries, pools, rounds, matches, locations] = await Promise.all([
    client.from('tournament_entries').select('tournament_id, player_id, pool_id').eq('tournament_id', id),
    client.from('pools').select('id, tournament_id, label').eq('tournament_id', id).order('label'),
    client
      .from('tournament_rounds')
      .select('id, tournament_id, bracket, round_number, name, sets_to_win, dart_start')
      .eq('tournament_id', id),
    client
      .from('matches')
      .select(
        'id, tournament_id, round_id, pool_id, position, home_player_id, away_player_id, winner_player_id, status, next_match_id, next_slot, loser_next_match_id, loser_next_slot, result_by, result_by_admin, result_first_at, result_at, scheduled_at, location_id, forfeit_player_id, match_sets(set_number, home_points, away_points)',
      )
      .eq('tournament_id', id)
      .order('position'),
    client.from('locations').select('id, name').order('name'),
  ])
  const entryRows = check(entries) as Entry[]
  type SetRow = { set_number: number; home_points: number; away_points: number }
  const rawMatches = check(matches) as (Match & { match_sets: SetRow[] | null })[]
  const sets = new Map<string, SetScore[]>()
  const matchRows: Match[] = rawMatches.map(({ match_sets, ...match }) => {
    if (match_sets?.length) {
      sets.set(
        match.id,
        [...match_sets]
          .sort((a, b) => a.set_number - b.set_number)
          .map((row) => ({ home: row.home_points, away: row.away_points })),
      )
    }
    return match
  })
  const playerIds = new Set<string>(entryRows.map((e) => e.player_id))
  for (const m of matchRows) {
    for (const p of [m.home_player_id, m.away_player_id, m.winner_player_id]) if (p) playerIds.add(p)
  }
  const players = playerIds.size
    ? (check(await client.from('players').select('id, profile_id, full_name').in('id', [...playerIds])) as Player[])
    : []
  const poolRows = check(pools) as Pool[]
  const tiebreaks = poolRows.length
    ? (check(
        await client
          .from('pool_tiebreaks')
          .select('id, pool_id, player_ids, ranking, result_by, result_by_admin, result_first_at, result_at')
          .in(
            'pool_id',
            poolRows.map((p) => p.id),
          ),
      ) as PoolTiebreak[])
    : []
  // Auteurs des résultats : les spectateurs ne lisent pas les profils (liste vide, sans erreur).
  const authorIds = [
    ...new Set([...matchRows, ...tiebreaks].map((m) => m.result_by).filter((id): id is string => Boolean(id))),
  ]
  const authorRows = authorIds.length
    ? ((await client.from('profiles').select('id, full_name').in('id', authorIds)).data ?? [])
    : []
  return {
    tournament,
    entries: entryRows,
    sets,
    authors: new Map((authorRows as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])),
    players: new Map(players.map((p) => [p.id, p])),
    pools: poolRows,
    tiebreaks,
    locations: check(locations) as Location[],
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

/**
 * Comptes inscriptibles (actifs, email confirmé — réservé à l'admin) et participants existants.
 * Un compte dont l'email n'a jamais été confirmé ne peut pas se connecter : il n'est pas proposé.
 */
export async function listSelectablePeople(): Promise<{
  accounts: { id: string; full_name: string }[]
  players: Player[]
}> {
  const client = db()
  const [accounts, players] = await Promise.all([
    client.rpc('admin_list_accounts'),
    client.from('players').select('id, profile_id, full_name').order('full_name'),
  ])
  const rows = check(accounts) as { id: string; full_name: string; status: string; email_confirmed: boolean }[]
  return {
    accounts: rows
      .filter((a) => a.status === 'active' && a.email_confirmed)
      .map(({ id, full_name }) => ({ id, full_name })),
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

export type NameOnlyPlayer = { id: string; full_name: string; tournaments: string[]; match_count: number }

/** « Noms seuls » avec les tournois où ils apparaissent (admin). */
export async function listNameOnlyPlayers(): Promise<NameOnlyPlayer[]> {
  return check(await db().rpc('admin_list_name_only_players')) as NameOnlyPlayer[]
}

/** Comptes (non supprimés) auxquels rattacher un nom seul, avec leur éventuelle fiche joueur. */
export async function listLinkableAccounts(): Promise<{ id: string; full_name: string; hasPlayer: boolean }[]> {
  const client = db()
  const [accounts, players] = await Promise.all([
    client.rpc('admin_list_accounts'),
    client.from('players').select('profile_id').not('profile_id', 'is', null),
  ])
  const withPlayer = new Set((check(players) as { profile_id: string }[]).map((p) => p.profile_id))
  return (check(accounts) as { id: string; full_name: string }[]).map((a) => ({
    id: a.id,
    full_name: a.full_name,
    hasPlayer: withPlayer.has(a.id),
  }))
}

/**
 * Rattache un nom seul à un compte : inscriptions et matchs (joués et à venir) basculent sur le compte.
 * Si le compte a déjà une fiche joueur, les deux sont fusionnées.
 */
export async function linkPlayerToAccount(playerId: string, profileId: string): Promise<void> {
  const result = await db().rpc('admin_link_player_to_account', { p_player_id: playerId, p_profile_id: profileId })
  if (result.error?.message?.includes('MERGE_CONFLICT') && 'details' in result.error && result.error.details) {
    throw new TournamentError(
      `Ce compte et ce nom seul jouent tous deux dans « ${String(result.error.details)} » : fusion impossible. Remplace d'abord l'un des deux dans ce tournoi.`,
    )
  }
  check(result)
}

export async function renamePlayer(playerId: string, fullName: string): Promise<void> {
  check(await db().from('players').update({ full_name: fullName.trim() }).eq('id', playerId))
}

export async function deletePlayer(playerId: string): Promise<void> {
  check(await db().from('players').delete().eq('id', playerId))
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

// ---------------------------------------------------------------- Résultats

/** Saisie ou correction d'un résultat. Mini-pong : sets ; fléchettes : vainqueur. */
export async function submitResult(
  matchId: string,
  result: { sets: SetScore[] } | { winnerPlayerId: string },
): Promise<void> {
  check(
    await db().rpc('submit_match_result', {
      p_match_id: matchId,
      p_winner_player_id: 'winnerPlayerId' in result ? result.winnerPlayerId : null,
      p_sets: 'sets' in result ? result.sets : null,
    }),
  )
}

export async function clearResult(matchId: string): Promise<void> {
  check(await db().rpc('clear_match_result', { p_match_id: matchId }))
}

// ---------------------------------------------------------------- Départages et phase finale

/** Départage : classement complet (du 1er au dernier) d'un groupe de joueurs à égalité. */
export async function submitTiebreak(poolId: string, ranking: string[]): Promise<void> {
  check(await db().rpc('submit_pool_tiebreak', { p_pool_id: poolId, p_ranking: ranking }))
}

export async function generateFinalPhase(tournamentId: string, draw: DrawResult): Promise<void> {
  check(await db().rpc('admin_generate_final_phase', { p_tournament_id: tournamentId, p_plan: draw.plan }))
}

export async function resetFinalPhase(tournamentId: string): Promise<void> {
  check(await db().rpc('admin_reset_final_phase', { p_tournament_id: tournamentId }))
}

// ---------------------------------------------------------------- Lieu, horaire, domicile/extérieur

/** Lieu et horaire d'un match (null = non renseigné). */
export async function setSchedule(matchId: string, scheduledAt: string | null, locationId: string | null): Promise<void> {
  check(
    await db().rpc('set_match_schedule', {
      p_match_id: matchId,
      p_scheduled_at: scheduledAt,
      p_location_id: locationId,
    }),
  )
}

export async function swapHomeAway(matchId: string): Promise<void> {
  check(await db().rpc('admin_swap_home_away', { p_match_id: matchId }))
}

export async function listLocations(): Promise<Location[]> {
  return check(await db().from('locations').select('id, name').order('name')) as Location[]
}

export async function addLocation(name: string): Promise<void> {
  check(await db().from('locations').insert({ name: name.trim() }))
}

export async function renameLocation(id: string, name: string): Promise<void> {
  check(await db().from('locations').update({ name: name.trim() }).eq('id', id))
}

export async function deleteLocation(id: string): Promise<void> {
  check(await db().from('locations').delete().eq('id', id))
}

// ---------------------------------------------------------------- Forfaits, annulations (admin)

export async function setWalkover(matchId: string, forfeitPlayerId: string): Promise<void> {
  check(await db().rpc('admin_set_walkover', { p_match_id: matchId, p_forfeit_player_id: forfeitPlayerId }))
}

/** Annulation d'un match de poule (ignoré du classement). */
export async function cancelMatch(matchId: string): Promise<void> {
  check(await db().rpc('admin_cancel_match', { p_match_id: matchId }))
}

/** Un forfait ou une annulation redevient un match à jouer. */
export async function reopenMatch(matchId: string): Promise<void> {
  check(await db().rpc('admin_reopen_match', { p_match_id: matchId }))
}

/** Forfait d'un joueur sur tous ses matchs non joués du tournoi. Renvoie le nombre de matchs concernés. */
export async function forfeitPlayer(tournamentId: string, playerId: string): Promise<number> {
  return check(
    await db().rpc('admin_forfeit_player', { p_tournament_id: tournamentId, p_player_id: playerId }),
  ) as number
}

export type DisabledPlayerPending = {
  tournament_id: string
  tournament_name: string
  player_id: string
  profile_id: string
  full_name: string
  pending_matches: number
}

/** Comptes désactivés qui ont encore des matchs à jouer dans un tournoi en cours. */
export async function listDisabledPlayersWithPendingMatches(): Promise<DisabledPlayerPending[]> {
  return check(await db().rpc('admin_disabled_players_with_pending_matches')) as DisabledPlayerPending[]
}
