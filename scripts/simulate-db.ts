/**
 * Simulation de bout en bout : des tournois complets joués dans une vraie base PostgreSQL
 * (migrations Supabase appliquées), avec la logique du site (tirage, classements, phase finale).
 *
 * Pour chaque tournoi (configuration aléatoire) :
 *   lancement → saisie de tous les résultats par les joueurs ou l'admin (corrections, effacements,
 *   inversions domicile/extérieur, lieux/horaires au passage) → classements et départages →
 *   phase finale → fin du tournoi, avec vérification des invariants après chaque action.
 *
 * Usage : node scripts/simulate-db.ts <nom_de_la_base> [nombre_de_tournois] [graine]
 * (connexion via PGHOST, PGPORT, PGUSER, PGPASSWORD)
 */
import pg from 'pg'
import { buildLaunchDraw, type DrawConfig } from '../src/lib/draw/plan.ts'
import { poolStandings, computeFinalPhase } from '../src/features/tournaments/standings.ts'
import type { Match, TournamentBundle, Tournament } from '../src/features/tournaments/types.ts'

const [, , database, countArg = '60', seedArg = String(Date.now() % 100000)] = process.argv
if (!database) throw new Error('Nom de la base manquant')
const TOURNAMENTS = Number(countArg)
let seed = Number(seedArg)
/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(): number {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]
const chance = (p: number) => rng() < p

const client = new pg.Client({ database })
await client.connect()

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const stats = {
  tournaments: 0,
  matches: 0,
  byPlayer: 0,
  byAdmin: 0,
  corrections: 0,
  clears: 0,
  swaps: 0,
  schedules: 0,
  tiebreaks: 0,
  finalPhases: 0,
  finalPhaseResets: 0,
  refusals: 0,
  replacements: 0,
  walkovers: 0,
  walkoversAwaitingOpponent: 0,
  cancellations: 0,
  reopenings: 0,
  playerForfeits: 0,
}

class Failure extends Error {}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Failure(message)
}

/** Exécute une requête en tant qu'utilisateur (droits et règles de sécurité appliqués), dans une transaction. */
async function as<T = unknown>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await client.query('set local role authenticated')
    const result = await client.query(sql, params)
    await client.query('commit')
    return result.rows as T[]
  } catch (e) {
    await client.query('rollback')
    ;(e as Error).message += ` [${sql.trim().split('\n')[0].slice(0, 60)}]`
    throw e
  }
}
/** Superutilisateur (mise en place et lectures de contrôle). */
async function su<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query(sql, params)).rows as T[]
}

// ---------------------------------------------------------------- Comptes
const accounts: string[] = []
await su(
  `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now())`,
  [ADMIN],
)
await su(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
for (let i = 1; i <= 20; i++) {
  const id = `00000000-0000-0000-0001-${String(i).padStart(12, '0')}`
  await su(
    `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, jsonb_build_object('full_name', $3::text), now())`,
    [id, `joueur${i}@fft.fr`, `Joueur ${i}`],
  )
  accounts.push(id)
}
const accountPlayer = new Map<string, string>() // profil → participant
for (const profileId of accounts) {
  const [row] = await as<{ id: string }>(
    ADMIN,
    `insert into public.players (profile_id, full_name) values ($1, '--') returning id`,
    [profileId],
  )
  accountPlayer.set(profileId, row.id)
}
const profileOfPlayer = new Map([...accountPlayer].map(([profile, player]) => [player, profile]))
const [{ id: locationId }] = await su<{ id: string }>(`select id from public.locations order by name limit 1`)

// ---------------------------------------------------------------- Lecture d'un tournoi (forme utilisée par le site)
async function loadBundle(tournamentId: string): Promise<TournamentBundle> {
  const [tournament] = await su<Tournament>(`select * from public.tournaments where id = $1`, [tournamentId])
  const entries = await su<TournamentBundle['entries'][number]>(
    `select tournament_id, player_id, pool_id from public.tournament_entries where tournament_id = $1`,
    [tournamentId],
  )
  const pools = await su<TournamentBundle['pools'][number]>(
    `select id, tournament_id, label from public.pools where tournament_id = $1 order by label`,
    [tournamentId],
  )
  const rounds = await su<TournamentBundle['rounds'][number]>(
    `select id, tournament_id, bracket, round_number, name, sets_to_win, dart_start from public.tournament_rounds where tournament_id = $1`,
    [tournamentId],
  )
  const matches = await su<Match>(
    `select id, tournament_id, round_id, pool_id, position, home_player_id, away_player_id, winner_player_id, status,
            next_match_id, next_slot, loser_next_match_id, loser_next_slot, result_by, result_by_admin,
            result_first_at::text, result_at::text, scheduled_at::text, location_id
     from public.matches where tournament_id = $1 order by position`,
    [tournamentId],
  )
  const setRows = await su<{ match_id: string; home_points: number; away_points: number }>(
    `select s.match_id, s.home_points, s.away_points from public.match_sets s
     join public.matches m on m.id = s.match_id where m.tournament_id = $1 order by s.match_id, s.set_number`,
    [tournamentId],
  )
  const sets = new Map<string, { home: number; away: number }[]>()
  for (const s of setRows) sets.set(s.match_id, [...(sets.get(s.match_id) ?? []), { home: s.home_points, away: s.away_points }])
  const tiebreaks = await su<TournamentBundle['tiebreaks'][number]>(
    `select t.id, t.pool_id, t.player_ids, t.ranking, t.result_by, t.result_by_admin, t.result_first_at::text, t.result_at::text
     from public.pool_tiebreaks t join public.pools p on p.id = t.pool_id where p.tournament_id = $1`,
    [tournamentId],
  )
  const players = await su<{ id: string; profile_id: string | null; full_name: string }>(`select * from public.players`)
  return {
    tournament,
    entries,
    players: new Map(players.map((p) => [p.id, p])),
    pools,
    rounds,
    matches,
    sets,
    tiebreaks,
    locations: [],
    authors: new Map(),
  }
}

// ---------------------------------------------------------------- Résultats aléatoires valides
function randomSets(setsToWin: number, winnerIsHome: boolean): { home: number; away: number }[] {
  const sets: { home: number; away: number }[] = []
  let won = 0
  let lost = 0
  while (won < setsToWin) {
    const winnerTakesSet = lost === setsToWin - 1 ? true : chance(0.65)
    const loserPoints = Math.floor(rng() * 10)
    const extended = chance(0.15)
    const [w, l] = extended ? [12 + Math.floor(rng() * 4), 0] : [11, loserPoints]
    const score = extended ? [w, w - 2] : [w, l]
    const [a, b] = winnerTakesSet ? score : [score[1], score[0]]
    sets.push(winnerIsHome ? { home: a, away: b } : { home: b, away: a })
    if (winnerTakesSet) won++
    else lost++
  }
  return sets
}

/** Profil autorisé à saisir pour ce match : un des joueurs (compte) ou l'admin. */
function actorFor(match: Match): string {
  const candidates = [match.home_player_id, match.away_player_id]
    .map((p) => (p ? profileOfPlayer.get(p) : undefined))
    .filter((p): p is string => Boolean(p))
  return candidates.length && chance(0.7) ? pick(candidates) : ADMIN
}

async function submit(actor: string, match: Match, discipline: string, setsToWin: number, winnerIsHome: boolean) {
  const winner = winnerIsHome ? match.home_player_id : match.away_player_id
  if (discipline === 'darts') {
    await as(actor, `select public.submit_match_result($1, $2, null)`, [match.id, winner])
  } else {
    await as(actor, `select public.submit_match_result($1, null, $2::jsonb)`, [
      match.id,
      JSON.stringify(randomSets(setsToWin, winnerIsHome)),
    ])
  }
}

/** Vérifie l'avancement d'un match joué : vainqueur et perdant à leur place (exempts de consolante compris). */
async function checkAdvancement(matchId: string) {
  const [m] = await su<Match & { forfeit_player_id: string | null }>(`select * from public.matches where id = $1`, [matchId])
  assert((m.status === 'played' || m.status === 'walkover') && m.winner_player_id, `match ${matchId} sans vainqueur`)
  assert([m.home_player_id, m.away_player_id].includes(m.winner_player_id), 'vainqueur hors du match')
  const loser = m.winner_player_id === m.home_player_id ? m.away_player_id : m.home_player_id
  if (m.status === 'walkover') assert(m.forfeit_player_id === loser, 'forfait : le perdant n’est pas le joueur forfait')
  for (const [target, slot, player] of [
    [m.next_match_id, m.next_slot, m.winner_player_id],
    [m.loser_next_match_id, m.loser_next_slot, loser],
  ] as const) {
    if (!target) continue
    const [t] = await su<Match>(`select * from public.matches where id = $1`, [target])
    assert(t[`${slot}_player_id` as 'home_player_id'] === player, `avancement incorrect vers ${t.plan_key ?? target}`)
    if (t.status === 'bye' || t.status === 'walkover') {
      assert(t.winner_player_id === player, `${t.status} : joueur arrivé non qualifié d’office`)
      if (t.next_match_id) {
        const [n] = await su<Match>(`select * from public.matches where id = $1`, [t.next_match_id])
        assert(n[`${t.next_slot}_player_id` as 'home_player_id'] === player, 'exempt de consolante : joueur non avancé')
      }
    }
  }
  // Les sets enregistrés désignent bien le vainqueur.
  const sets = await su<{ home_points: number; away_points: number }>(
    `select home_points, away_points from public.match_sets where match_id = $1 order by set_number`,
    [matchId],
  )
  if (sets.length) {
    const home = sets.filter((s) => s.home_points > s.away_points).length
    const away = sets.length - home
    assert((home > away) === (m.winner_player_id === m.home_player_id), 'sets incohérents avec le vainqueur')
  }
}

async function expectRefusal(promise: Promise<unknown>, code: string, label: string) {
  try {
    await promise
  } catch (e) {
    assert(String((e as Error).message).includes(code), `${label} : erreur inattendue ${(e as Error).message}`)
    stats.refusals++
    return
  }
  throw new Failure(`${label} : aucune erreur (attendu ${code})`)
}

// ---------------------------------------------------------------- Un tournoi complet
async function playTournament(index: number) {
  const discipline = pick(['mini_pong', 'darts'] as const)
  const playerCount = 2 + Math.floor(rng() * 15) // 2 à 16
  let format: DrawConfig['format'] = chance(0.5) && playerCount >= 4 ? 'pools_knockout' : 'knockout'
  let poolCount: number | null = null
  let qualifiers: number | null = null
  if (format === 'pools_knockout') {
    poolCount = 1 + Math.floor(rng() * Math.min(4, Math.floor(playerCount / 2)))
    const smallest = Math.floor(playerCount / poolCount)
    qualifiers = 1 + Math.floor(rng() * Math.min(smallest, 3))
    if (poolCount * qualifiers < 2) format = 'knockout'
  }
  if (format === 'knockout') {
    poolCount = null
    qualifiers = null
  }
  const config: DrawConfig = {
    format,
    poolCount,
    qualifiersPerPool: qualifiers,
    thirdPlace: chance(0.5),
    consolation: chance(0.5),
  }

  // Participants : comptes (droits joueur réels) et noms seuls
  const players: string[] = []
  const shuffledAccounts = [...accountPlayer.values()].sort(() => rng() - 0.5)
  for (let i = 0; i < playerCount; i++) {
    if (chance(0.6) && shuffledAccounts.length) players.push(shuffledAccounts.pop() as string)
    else {
      const [row] = await as<{ id: string }>(ADMIN, `insert into public.players (full_name) values ($1) returning id`, [
        `Nom seul ${index}-${i}`,
      ])
      players.push(row.id)
    }
  }
  const [{ id: tournamentId }] = await as<{ id: string }>(
    ADMIN,
    `insert into public.tournaments (name, discipline, format, pool_count, qualifiers_per_pool, qualifier_placement,
       third_place, consolation, default_sets_to_win, default_dart_start)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 301) returning id`,
    [
      `Simulation ${index}`,
      discipline,
      format,
      poolCount,
      qualifiers,
      pick(['classic', 'random']),
      config.thirdPlace,
      config.consolation,
      1 + Math.floor(rng() * 3),
    ],
  )
  for (const p of players) {
    await as(ADMIN, `insert into public.tournament_entries (tournament_id, player_id) values ($1, $2)`, [tournamentId, p])
  }
  const draw = buildLaunchDraw(players, config, rng)
  await as(ADMIN, `select public.admin_launch_tournament($1, $2::jsonb)`, [tournamentId, JSON.stringify(draw.plan)])
  const label = `tournoi ${index} (${discipline}, ${playerCount} joueurs, ${format}${poolCount ? ` ${poolCount}×${qualifiers}` : ''}${config.thirdPlace ? ', 3e place' : ''}${config.consolation ? ', consolante' : ''})`

  let finalPhaseDone = format === 'knockout'
  let finalResetDone = false
  for (let guard = 0; guard < 2000; guard++) {
    const bundle = await loadBundle(tournamentId)
    const roundOf = new Map(bundle.rounds.map((r) => [r.id, r]))
    const playable = bundle.matches.filter((m) => m.status === 'pending' && m.home_player_id && m.away_player_id)

    if (playable.length === 0) {
      if (finalPhaseDone) break
      // Poules terminées : départages, puis phase finale.
      for (const { pool, result } of poolStandings(bundle)) {
        assert(result.complete, `${label} : poule ${pool.label} incomplète sans match jouable`)
        for (const group of result.pendingTies) {
          const ranking = [...group].sort(() => rng() - 0.5)
          const concerned = group.map((p) => profileOfPlayer.get(p)).filter((p): p is string => Boolean(p))
          const actor = discipline === 'darts' && concerned.length && chance(0.7) ? pick(concerned) : ADMIN
          await as(actor, `select public.submit_pool_tiebreak($1, $2::uuid[])`, [pool.id, ranking])
          stats.tiebreaks++
        }
      }
      const final = computeFinalPhase(await loadBundle(tournamentId))
      assert(final.ok, `${label} : phase finale impossible (${final.ok ? '' : final.problems.join(' ; ')})`)
      await as(ADMIN, `select public.admin_generate_final_phase($1, $2::jsonb)`, [tournamentId, JSON.stringify(final.draw.plan)])
      stats.finalPhases++
      // Une fois sur trois : annulation puis nouvelle génération (aucun match de la phase finale n'est joué).
      if (!finalResetDone && chance(0.33)) {
        await as(ADMIN, `select public.admin_reset_final_phase($1)`, [tournamentId])
        await as(ADMIN, `select public.admin_generate_final_phase($1, $2::jsonb)`, [tournamentId, JSON.stringify(final.draw.plan)])
        finalResetDone = true
        stats.finalPhaseResets++
      }
      // Résultats de poule figés
      const poolMatch = bundle.matches.find((m) => m.pool_id && m.status === 'played')
      if (poolMatch) {
        await expectRefusal(as(ADMIN, `select public.clear_match_result($1)`, [poolMatch.id]), 'FINAL_PHASE_EXISTS', label)
      }
      finalPhaseDone = true
      continue
    }

    const match = pick(playable)
    const round = roundOf.get(match.round_id)
    assert(round, 'tour introuvable')

    // Au passage : lieu/horaire proposé par un joueur, inversion domicile/extérieur par l'admin.
    if (chance(0.2)) {
      const day = 1 + Math.floor(rng() * 5) // 1er au 5 février 2027 : lundi → vendredi
      const time = `${String(8 + Math.floor(rng() * 11)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`
      await as(actorFor(match), `select public.set_match_schedule($1, $2::timestamptz, $3)`, [
        match.id,
        `2027-02-0${day} ${time}:00 Europe/Paris`,
        locationId,
      ])
      stats.schedules++
    }
    // Forfait (admin) sur un match en attente d'un adversaire : qualifié d'office à son arrivée.
    const waiting = bundle.matches.filter(
      (m) => m.status === 'pending' && Boolean(m.home_player_id) !== Boolean(m.away_player_id),
    )
    if (waiting.length && chance(0.04)) {
      const w = pick(waiting)
      await as(ADMIN, `select public.admin_set_walkover($1, $2)`, [w.id, w.home_player_id ?? w.away_player_id])
      stats.walkoversAwaitingOpponent++
      continue
    }
    // Forfait d'un joueur sur tous ses matchs non joués (compte désactivé non remplacé).
    if (chance(0.01)) {
      const forfeiter = pick([match.home_player_id, match.away_player_id] as string[])
      const n = await as<{ admin_forfeit_player: number }>(ADMIN, `select public.admin_forfeit_player($1, $2)`, [
        tournamentId,
        forfeiter,
      ])
      assert(n[0].admin_forfeit_player >= 1, 'forfait global sans effet')
      const left = await su(
        `select 1 from public.matches where tournament_id = $1 and status = 'pending' and $2 in (home_player_id, away_player_id)
           and not (pool_id is not null and public.has_final_phase(tournament_id))`,
        [tournamentId, forfeiter],
      )
      assert(left.length === 0, 'forfait global : il reste des matchs à jouer')
      stats.playerForfeits++
      continue
    }
    // Forfait d'un joueur sur ce match, ou annulation (poules), puis parfois rétablissement.
    if (chance(0.06)) {
      const cancel = Boolean(match.pool_id) && chance(0.4)
      if (cancel) {
        await as(ADMIN, `select public.admin_cancel_match($1)`, [match.id])
        stats.cancellations++
      } else {
        await as(ADMIN, `select public.admin_set_walkover($1, $2)`, [match.id, pick([match.home_player_id, match.away_player_id])])
        stats.walkovers++
        await checkAdvancement(match.id)
      }
      if (chance(0.25)) {
        await as(ADMIN, `select public.admin_reopen_match($1)`, [match.id])
        stats.reopenings++
      }
      continue
    }

    // Remplacement d'un joueur en cours de tournoi (ses matchs joués restent à son nom).
    if (chance(0.03)) {
      const replaced = pick([match.home_player_id, match.away_player_id] as string[])
      const [fresh] = await as<{ id: string }>(ADMIN, `insert into public.players (full_name) values ($1) returning id`, [
        `Remplaçant ${index}-${guard}`,
      ])
      await as(ADMIN, `select public.admin_replace_player($1, $2, $3)`, [tournamentId, replaced, fresh.id])
      const [after] = await su<Match>(`select * from public.matches where id = $1`, [match.id])
      assert([after.home_player_id, after.away_player_id].includes(fresh.id), 'remplacement : remplaçant absent du match')
      stats.replacements++
      continue
    }
    if (chance(0.1)) {
      await as(ADMIN, `select public.admin_swap_home_away($1)`, [match.id])
      stats.swaps++
      continue
    }

    const actor = actorFor(match)
    // Un joueur hors du match ne peut pas saisir.
    const outsider = [...accountPlayer].find(([, p]) => p !== match.home_player_id && p !== match.away_player_id)
    if (outsider && chance(0.05)) {
      await expectRefusal(
        as(outsider[0], `select public.submit_match_result($1, $2, $3::jsonb)`, [
          match.id,
          match.home_player_id,
          discipline === 'darts' ? null : JSON.stringify(randomSets(round.sets_to_win, true)),
        ]),
        'NOT_MY_MATCH',
        label,
      )
    }
    const homeWins = chance(0.5)
    await submit(actor, match, discipline, round.sets_to_win, homeWins)
    if (actor === ADMIN) stats.byAdmin++
    else stats.byPlayer++
    stats.matches++
    await checkAdvancement(match.id)

    // Correction immédiate par l'auteur (vainqueur inversé), ou effacement puis nouvelle saisie.
    if (chance(0.12)) {
      await submit(actor, match, discipline, round.sets_to_win, !homeWins)
      stats.corrections++
      await checkAdvancement(match.id)
    } else if (chance(0.05)) {
      await as(actor, `select public.clear_match_result($1)`, [match.id])
      stats.clears++
      const [cleared] = await su<Match>(`select * from public.matches where id = $1`, [match.id])
      assert(cleared.status === 'pending' && !cleared.winner_player_id, 'effacement incomplet')
      if (cleared.next_match_id) {
        const [n] = await su<Match>(`select * from public.matches where id = $1`, [cleared.next_match_id])
        assert(n[`${cleared.next_slot}_player_id` as 'home_player_id'] === null, 'effacement : vainqueur resté au tour suivant')
      }
      await submit(actor, match, discipline, round.sets_to_win, homeWins)
      await checkAdvancement(match.id)
    }
    // L'adversaire (compte) ne peut pas corriger un résultat saisi par l'autre.
    const opponent = [match.home_player_id, match.away_player_id]
      .map((p) => (p ? profileOfPlayer.get(p) : undefined))
      .find((p) => p && p !== actor)
    if (opponent && actor !== ADMIN && chance(0.1)) {
      await expectRefusal(as(opponent, `select public.clear_match_result($1)`, [match.id]), 'RESULT_LOCKED', label)
    }
  }

  // ---------------------------------------------------------------- Fin du tournoi : invariants
  const end = await loadBundle(tournamentId)
  const roundOf = new Map(end.rounds.map((r) => [r.id, r]))
  for (const m of end.matches) {
    assert(['played', 'bye', 'walkover', 'cancelled'].includes(m.status), `${label} : match resté « ${m.status} »`)
    if (m.status !== 'cancelled') assert(m.winner_player_id, `${label} : match « ${m.status} » sans vainqueur`)
    if (m.status === 'cancelled') assert(m.pool_id, `${label} : match de tableau annulé`)
  }
  const main = end.rounds.filter((r) => r.bracket === 'main')
  const lastMain = main.reduce((a, b) => (a.round_number > b.round_number ? a : b))
  const finals = end.matches.filter((m) => m.round_id === lastMain.id)
  assert(finals.length === 1 && finals[0].winner_player_id, `${label} : pas de champion`)
  // Tableau principal : chaque joueur perd au plus une fois ; le champion ne perd jamais.
  const mainLosses = new Map<string, number>()
  for (const m of end.matches.filter(
    (x) => roundOf.get(x.round_id)?.bracket === 'main' && (x.status === 'played' || x.status === 'walkover'),
  )) {
    const loser = m.winner_player_id === m.home_player_id ? m.away_player_id : m.home_player_id
    mainLosses.set(loser as string, (mainLosses.get(loser as string) ?? 0) + 1)
  }
  assert([...mainLosses.values()].every((n) => n === 1), `${label} : un joueur a perdu deux fois dans le tableau principal`)
  assert(!mainLosses.has(finals[0].winner_player_id as string), `${label} : le champion a perdu un match`)
  // Nombre de joueurs au 1er tour du tableau principal = inscrits (élimination) ou qualifiés (poules).
  const mainPlayers = new Set(
    end.matches
      .filter((x) => roundOf.get(x.round_id)?.bracket === 'main' && roundOf.get(x.round_id)?.round_number === 1)
      .flatMap((x) => [x.home_player_id, x.away_player_id])
      .filter(Boolean),
  )
  const expected = format === 'knockout' ? playerCount : (poolCount as number) * (qualifiers as number)
  assert(mainPlayers.size === expected, `${label} : ${mainPlayers.size} joueurs au 1er tour du tableau principal (attendu ${expected})`)
  // Classements de poule : chaque match de poule joué compte pour au moins un joueur classé ;
  // le total des victoires des joueurs classés = matchs joués moins les victoires de joueurs remplacés.
  if (format === 'pools_knockout') {
    for (const { pool, result } of poolStandings(end)) {
      const ranked = new Set(result.rows.map((r) => r.playerId))
      const poolMatches = end.matches.filter((m) => m.pool_id === pool.id && (m.status === 'played' || m.status === 'walkover'))
      const expectedWins = poolMatches.filter((m) => ranked.has(m.winner_player_id as string)).length
      const expectedPlayed = poolMatches.reduce(
        (n, m) => n + (ranked.has(m.home_player_id as string) ? 1 : 0) + (ranked.has(m.away_player_id as string) ? 1 : 0),
        0,
      )
      assert(result.rows.reduce((n, r) => n + r.wins, 0) === expectedWins, `${label} : victoires de poule ${pool.label} mal comptées`)
      assert(result.rows.reduce((n, r) => n + r.played, 0) === expectedPlayed, `${label} : matchs de poule ${pool.label} mal comptés`)
    }
  }
  // Format de jeu verrouillé sur les tours joués.
  const playedRound = end.rounds.find((r) =>
    end.matches.some((m) => m.round_id === r.id && (m.status === 'played' || m.status === 'walkover')),
  )
  if (playedRound) {
    await expectRefusal(
      as(ADMIN, `update public.tournament_rounds set dart_start = case dart_start when 301 then 501 else 301 end where id = $1`, [
        playedRound.id,
      ]),
      'ROUND_LOCKED',
      label,
    )
  }
  await as(ADMIN, `select public.admin_set_tournament_status($1, 'finished')`, [tournamentId])
  // Tournoi terminé : saisie joueur refusée.
  const someone = end.matches.find((m) => m.status === 'played' && m.home_player_id && profileOfPlayer.get(m.home_player_id))
  if (someone) {
    await expectRefusal(
      as(profileOfPlayer.get(someone.home_player_id as string) as string, `select public.clear_match_result($1)`, [someone.id]),
      'TOURNAMENT_CLOSED',
      label,
    )
  }
  stats.tournaments++
  return label
}

const startSeed = seed
let failures = 0
for (let i = 1; i <= TOURNAMENTS; i++) {
  try {
    const label = await playTournament(i)
    if (process.env.VERBOSE) console.log(`  ok — ${label}`)
  } catch (e) {
    failures++
    console.error(`  ÉCHEC — tournoi ${i} : ${(e as Error).message}`)
    if (failures >= 5) break
  }
}
await client.end()
console.log(`  graine ${startSeed} · ${JSON.stringify(stats)}`)
if (failures) {
  console.error(`❌ ${failures} tournoi(s) en échec sur ${TOURNAMENTS}`)
  process.exit(1)
}
console.log(`✅ Simulation : ${stats.tournaments} tournois complets joués sans erreur`)
