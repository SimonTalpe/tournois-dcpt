/**
 * Test de concurrence de l'Elo et des matchs classés : plusieurs clients en parallèle sur une vraie base
 * (migrations appliquées). Vérifie :
 *  1. la limite de 3 matchs classés par jour tient quand plusieurs téléphones valident en même temps ;
 *  2. aucun interblocage ni erreur imprévue sous un mélange de saisies, corrections, effacements,
 *     lectures du leaderboard et résultats de tournoi ;
 *  3. l'Elo final de la base = calcul de référence du site (aucune modification perdue).
 *
 * Usage : node scripts/stress-elo.ts <nom_de_la_base> [clients] [opérations par client]
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { replayElo, type EloEvent } from '../src/features/ranking/elo.ts'

const [, , database, clientsArg = '8', opsArg = '150'] = process.argv
if (!database) throw new Error('Nom de la base manquant')
const CLIENTS = Number(clientsArg)
const OPS = Number(opsArg)

const admin = new pg.Client({ database })
await admin.connect()
const su = async <T = unknown>(sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows as T[]

// ---------------------------------------------------------------- Comptes et un tournoi de mini-pong à remplir
const ADMIN = '00000000-0000-0000-0000-00000000000a'
await su(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, 'sim@fft.fr', '{"full_name":"Sim"}', now())`, [ADMIN])
await su(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
const accounts: string[] = []
for (let i = 1; i <= 8; i++) {
  const id = `00000000-0000-0000-0002-${String(i).padStart(12, '0')}`
  await su(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, jsonb_build_object('full_name', $3::text), now())`, [
    id,
    `stress${i}@fft.fr`,
    `Stress ${i}`,
  ])
  accounts.push(id)
}
const players = new Map<string, string>()
for (const profile of accounts) {
  const [row] = await su<{ id: string }>(`insert into public.players (profile_id, full_name) values ($1, '--') returning id`, [profile])
  players.set(profile, row.id)
}
const [{ id: tournamentId }] = await su<{ id: string }>(
  `insert into public.tournaments (name, discipline, status, default_sets_to_win) values ('Stress', 'mini_pong', 'in_progress', 1) returning id`,
)
const [{ id: roundId }] = await su<{ id: string }>(
  `insert into public.tournament_rounds (tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
   values ($1, 'pool', 1, 'Poules', 1, 301, 'pool-1') returning id`,
  [tournamentId],
)
const tournamentMatches: { id: string; home: string; away: string }[] = []
let position = 0
for (const a of accounts) {
  for (const b of accounts) {
    if (a >= b) continue
    position++
    const [m] = await su<{ id: string }>(
      `insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status)
       values ($1, $2, $3, $4, $5, $6, 'pending') returning id`,
      [tournamentId, roundId, position, `m${position}`, players.get(a), players.get(b)],
    )
    tournamentMatches.push({ id: m.id, home: a, away: b })
  }
}

async function as<T = unknown>(client: pg.Client, userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await client.query('set local role authenticated')
    const result = await client.query(sql, params)
    await client.query('commit')
    return result.rows as T[]
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}

const EXPECTED = ['RANKED_DAILY_LIMIT', 'RANKED_LOCKED', 'NOT_FOUND', 'RESULT_LOCKED', 'MATCH_NOT_READY']
const counts: Record<string, number> = {}
const failures: string[] = []
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)

// ---------------------------------------------------------------- 1. Course sur la limite quotidienne
{
  const [a, b] = accounts
  const pool = await Promise.all(Array.from({ length: 8 }, async () => {
    const c = new pg.Client({ database })
    await c.connect()
    return c
  }))
  const results = await Promise.allSettled(
    pool.map((c, i) =>
      as(c, i % 2 ? a : b, `select public.record_ranked_match($1, 'mini_pong', $2, $3, '{"home":11,"away":4}')`, [
        randomUUID(),
        i % 2 ? a : b,
        i % 2 ? b : a,
      ]),
    ),
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const refused = results.filter((r) => r.status === 'rejected' && String(r.reason).includes('RANKED_DAILY_LIMIT')).length
  if (ok !== 3 || refused !== 5) failures.push(`course limite quotidienne : ${ok} acceptés, ${refused} refusés (attendu 3 / 5)`)
  else console.log('  ok — 8 validations simultanées : 3 acceptées, 5 refusées (limite quotidienne)')
  await Promise.all(pool.map((c) => c.end()))
}

// ---------------------------------------------------------------- 2. Mélange d'opérations en parallèle
const created: { id: string; author: string; discipline: string }[] = []
async function worker(index: number) {
  const client = new pg.Client({ database })
  await client.connect()
  let seed = index * 7919 + 17
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rng() * list.length)]
  for (let i = 0; i < OPS; i++) {
    const roll = rng()
    const me = pick(accounts)
    try {
      if (roll < 0.35) {
        const discipline = pick(['mini_pong', 'darts'])
        const other = pick(accounts.filter((x) => x !== me))
        const id = randomUUID()
        const score = discipline === 'mini_pong' ? (rng() < 0.5 ? { home: 11, away: 6 } : { home: 6, away: 11 }) : { winner: pick(['home', 'away']) }
        await as(client, me, `select public.record_ranked_match($1, $2, $3, $4, $5)`, [id, discipline, me, other, score])
        created.push({ id, author: me, discipline })
        bump('saisies')
      } else if (roll < 0.45 && created.length) {
        const target = pick(created)
        const score = target.discipline === 'mini_pong' ? { home: 11, away: 9 } : { winner: 'away', loser_remaining: 12 }
        await as(client, target.author, `select public.correct_ranked_match($1, $2)`, [target.id, score])
        bump('corrections')
      } else if (roll < 0.5 && created.length) {
        const target = created.splice(Math.floor(rng() * created.length), 1)[0]
        await as(client, target.author, `select public.delete_ranked_match($1)`, [target.id])
        bump('effacements')
      } else if (roll < 0.65) {
        const m = pick(tournamentMatches)
        const actor = rng() < 0.5 ? m.home : ADMIN
        if (rng() < 0.7) {
          await as(client, actor, `select public.submit_match_result($1, null, $2)`, [m.id, JSON.stringify([rng() < 0.5 ? { home: 11, away: 3 } : { home: 3, away: 11 }])])
          bump('scores tournoi')
        } else {
          await as(client, ADMIN, `select public.clear_match_result($1)`, [m.id])
          bump('effacements tournoi')
        }
      } else {
        await as(client, me, `select count(*) from public.get_elo_history($1)`, [pick(['mini_pong', 'darts'])])
        bump('lectures')
      }
    } catch (e) {
      const message = String((e as Error).message)
      if (EXPECTED.some((code) => message.includes(code))) bump('refus attendus')
      else {
        failures.push(`client ${index} : ${message} (${(e as { code?: string }).code ?? ''})`)
        if ((e as { code?: string }).code === '40P01') bump('INTERBLOCAGES')
      }
    }
  }
  await client.end()
}
const started = Date.now()
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => worker(i)))
console.log(`  ${CLIENTS} clients × ${OPS} opérations en ${((Date.now() - started) / 1000).toFixed(1)} s : ${JSON.stringify(counts)}`)

// ---------------------------------------------------------------- 3. Elo final = calcul de référence
for (const discipline of ['mini_pong', 'darts'] as const) {
  const events = await su<{
    source: 'tournament' | 'ranked'; id: string; played_at: string; home_id: string; away_id: string
    winner_id: string; home_account: boolean; away_account: boolean
  }>(
    `select * from (
       select 'tournament' as source, m.id, coalesce(m.result_first_at, m.updated_at) as played_at,
              m.home_player_id as home_id, m.away_player_id as away_id, m.winner_player_id as winner_id,
              hp.profile_id is not null as home_account, ap.profile_id is not null as away_account
       from public.matches m join public.tournaments t on t.id = m.tournament_id
       join public.players hp on hp.id = m.home_player_id join public.players ap on ap.id = m.away_player_id
       where t.discipline = $1 and m.status = 'played' and (hp.profile_id is not null or ap.profile_id is not null)
       union all
       select 'ranked', r.id, r.played_at, r.home_player_id, r.away_player_id, r.winner_player_id, true, true
       from public.ranked_matches r where r.discipline = $1
     ) e order by e.played_at, e.id`,
    [discipline],
  )
  const expected = replayElo(events.map((e): EloEvent => ({
    id: e.id, source: e.source, playedAt: String(e.played_at), homeId: e.home_id, awayId: e.away_id,
    homeAccount: e.home_account, awayAccount: e.away_account, winnerId: e.winner_id,
  })))
  const actual = await as<{ player_id: string; seq: number; match_id: string; rating_after: number }>(
    admin, accounts[0], `select player_id, seq, match_id, rating_after from public.get_elo_history($1)`, [discipline],
  )
  const byKey = new Map(actual.map((r) => [`${r.player_id}#${r.seq}`, r]))
  const mismatches = expected.filter((r) => {
    const got = byKey.get(`${r.playerId}#${r.seq}`)
    return !got || got.match_id !== r.matchId || got.rating_after !== r.ratingAfter
  })
  if (mismatches.length || actual.length !== expected.length) {
    failures.push(`Elo ${discipline} : ${actual.length} lignes, attendu ${expected.length}, ${mismatches.length} écarts`)
  } else {
    console.log(`  ok — Elo ${discipline} : ${actual.length} lignes identiques au calcul de référence`)
  }
}
await admin.end()

if (failures.length) {
  console.error(failures.slice(0, 15).map((f) => `  ÉCHEC — ${f}`).join('\n'))
  console.error(`❌ ${failures.length} échec(s)`)
  process.exit(1)
}
console.log('✅ Concurrence : aucun interblocage, limite respectée, Elo cohérent')
