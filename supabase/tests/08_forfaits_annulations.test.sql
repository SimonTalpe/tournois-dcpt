-- Tests de l'étape 4 : forfaits, annulations, rétablissement, compte désactivé.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set t1 '''10000000-0000-0000-0000-000000000001'''
\set t2 '''10000000-0000-0000-0000-000000000002'''
\set r1 '''30000000-0000-0000-0000-000000000001'''
\set r2 '''30000000-0000-0000-0000-000000000002'''
\set r3 '''30000000-0000-0000-0000-000000000003'''
\set rp '''30000000-0000-0000-0000-000000000004'''
\set pool_a '''50000000-0000-0000-0000-00000000000a'''
\set pa '''20000000-0000-0000-0000-0000000000a1'''
\set pb '''20000000-0000-0000-0000-0000000000b0'''
\set pc '''20000000-0000-0000-0000-000000000003'''
\set pd '''20000000-0000-0000-0000-000000000004'''
\set m1 '''40000000-0000-0000-0000-000000000001'''
\set m2 '''40000000-0000-0000-0000-000000000002'''
\set m3 '''40000000-0000-0000-0000-000000000003'''
\set m4 '''40000000-0000-0000-0000-000000000004'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--');
insert into public.players (id, full_name) values (:pc, 'Chloé'), (:pd, 'David');

-- T1 : demi-finales M1 (Alice–Bob), M2 (Chloé–David) → finale M3 ; perdants → 3e place M4.
insert into public.tournaments (id, name, discipline, status, third_place) values (:t1, 'Fléchettes', 'darts', 'in_progress', true);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'main', 1, 'Demi-finales', 1, 301, 'main-1'),
  (:r2, :t1, 'main', 2, 'Finale', 1, 301, 'main-2'),
  (:r3, :t1, 'third_place', 1, '3e place', 1, 301, 'third_place-1');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb), (:t1, :pc), (:t1, :pd);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:m3, :t1, :r2, 1, 'main-2-1', null, null),
  (:m4, :t1, :r3, 1, 'third_place-1-1', null, null),
  (:m1, :t1, :r1, 1, 'main-1-1', :pa, :pb),
  (:m2, :t1, :r1, 2, 'main-1-2', :pc, :pd);
update public.matches set next_match_id = :m3, next_slot = 'home', loser_next_match_id = :m4, loser_next_slot = 'home' where id = :m1;
update public.matches set next_match_id = :m3, next_slot = 'away', loser_next_match_id = :m4, loser_next_slot = 'away' where id = :m2;

set local role authenticated;

-- ---------------------------------------------------------------- Droits
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_set_walkover(%L, %L)$$, :m1, :pb), 'FORBIDDEN', 'joueur : forfait interdit');
select tests.expect_error(format($$select public.admin_forfeit_player(%L, %L)$$, :t1, :pb), 'FORBIDDEN', 'joueur : forfait global interdit');

-- ---------------------------------------------------------------- Forfait, adversaire connu
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_set_walkover(%L, %L)$$, :m1, :pc), 'NOT_IN_MATCH', 'forfait d''un joueur hors du match refusé');
select public.admin_set_walkover(:m1, :pb);
select tests.assert(
  (select status = 'walkover' and winner_player_id = :pa::uuid and forfeit_player_id = :pb::uuid and result_by_admin
   from public.matches where id = :m1)
  and (select home_player_id from public.matches where id = :m3) = :pa::uuid
  and (select home_player_id from public.matches where id = :m4) = :pb::uuid,
  'forfait : adversaire qualifié, joueur forfait envoyé en 3e place');
select tests.expect_error(format($$select public.admin_set_walkover(%L, %L)$$, :m1, :pa), 'MATCH_NOT_PENDING', 'forfait sur un match déjà décidé refusé');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.clear_match_result(%L)$$, :m1), 'MATCH_NOT_READY', 'joueur : effacement d''un forfait impossible');

-- ---------------------------------------------------------------- Forfait, adversaire pas encore connu
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_walkover(:m3, :pa);
select tests.assert((select status = 'walkover' and winner_player_id is null from public.matches where id = :m3),
  'forfait en finale avant de connaître l''adversaire : vainqueur en attente');
select public.submit_match_result(:m2, :pd, null);
select tests.assert(
  (select winner_player_id = :pd::uuid and away_player_id = :pd::uuid from public.matches where id = :m3)
  and (select away_player_id from public.matches where id = :m4) = :pc::uuid,
  'arrivée de l''adversaire : qualifié d''office ; le perdant de la demi va en 3e place');
select public.submit_match_result(:m2, :pc, null);
select tests.assert(
  (select winner_player_id = :pc::uuid and away_player_id = :pc::uuid from public.matches where id = :m3)
  and (select away_player_id from public.matches where id = :m4) = :pd::uuid,
  'correction de la demi : la qualification automatique face au forfait suit (finale et 3e place)');
select tests.expect_error(format($$select public.submit_match_result(%L, %L, null)$$, :m1, :pa),
  'MATCH_NOT_READY', 'demi décidée par forfait : pas de saisie de score');

-- ---------------------------------------------------------------- Rétablir
select public.admin_reopen_match(:m3);
select tests.assert(
  (select status = 'pending' and winner_player_id is null and forfeit_player_id is null from public.matches where id = :m3),
  'forfait rétabli : match à jouer');
select public.admin_reopen_match(:m1);
select tests.assert(
  (select home_player_id is null from public.matches where id = :m3)
  and (select home_player_id is null from public.matches where id = :m4),
  'forfait rétabli : avancement retiré (finale et 3e place)');
select tests.expect_error(format($$select public.admin_reopen_match(%L)$$, :m1), 'MATCH_NOT_REOPENABLE', 'rétablir un match à jouer : refusé');
select tests.expect_error(format($$select public.admin_cancel_match(%L)$$, :m1), 'CANCEL_POOL_ONLY', 'annulation d''un match de tableau refusée');

-- ---------------------------------------------------------------- Compte désactivé : forfait sur tous ses matchs
select public.admin_set_account_status(:bob_id, 'disabled');
select tests.assert(
  (select count(*) from public.admin_disabled_players_with_pending_matches() where player_id = :pb) = 1,
  'compte désactivé avec des matchs à jouer : signalé à l''admin');
select tests.assert(public.admin_forfeit_player(:t1, :pb) = 2,
  'forfait global : demi-finale puis match pour la 3e place (où il a été envoyé)');
select tests.assert(
  (select status from public.matches where id = :m1) = 'walkover'
  and (select status = 'walkover' and forfeit_player_id = :pb::uuid from public.matches where id = :m4),
  'forfait global : tous ses matchs non joués');
select tests.assert(
  not exists (select 1 from public.admin_disabled_players_with_pending_matches() where player_id = :pb),
  'plus aucun match à jouer : plus signalé');

-- ---------------------------------------------------------------- Poules : annulation et forfait dans le classement
reset role;
insert into public.tournaments (id, name, discipline, format, status, pool_count, qualifiers_per_pool)
values (:t2, 'Poules', 'darts', 'pools_knockout', 'in_progress', 1, 1);
insert into public.pools (id, tournament_id, label) values (:pool_a, :t2, 'A');
insert into public.tournament_entries (tournament_id, player_id, pool_id) values (:t2, :pa, :pool_a), (:t2, :pc, :pool_a), (:t2, :pd, :pool_a);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:rp, :t2, 'pool', 1, 'Poules', 1, 301, 'pool-1');
insert into public.matches (tournament_id, round_id, pool_id, position, plan_key, home_player_id, away_player_id) values
  (:t2, :rp, :pool_a, 1, 'pool-A-1', :pa, :pc),
  (:t2, :rp, :pool_a, 2, 'pool-A-2', :pc, :pd),
  (:t2, :rp, :pool_a, 3, 'pool-A-3', :pd, :pa);
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_cancel_match((select id from public.matches where plan_key = 'pool-A-1' and tournament_id = :t2));
select public.admin_set_walkover((select id from public.matches where plan_key = 'pool-A-2' and tournament_id = :t2), :pc);
select tests.assert(
  (select status from public.matches where plan_key = 'pool-A-1' and tournament_id = :t2) = 'cancelled'
  and (select winner_player_id from public.matches where plan_key = 'pool-A-2' and tournament_id = :t2) = :pd::uuid,
  'poule : match annulé, forfait');
select tests.expect_error(
  format($$update public.tournament_rounds set dart_start = 501 where id = %L$$, :rp),
  'ROUND_LOCKED', 'forfait : format du tour verrouillé');
select public.submit_match_result((select id from public.matches where plan_key = 'pool-A-3' and tournament_id = :t2), :pd, null);
select public.admin_generate_final_phase(:t2, format($json${"pools": [], "rounds": [{"key": "main-1", "bracket": "main", "roundNumber": 1, "name": "Finale"}],
  "matches": [{"key": "main-1-1", "roundKey": "main-1", "poolLabel": null, "position": 1, "home": %s, "away": null,
  "status": "bye", "winner": %s, "next": null, "loserNext": null}]}$json$, to_jsonb(:pd::text), to_jsonb(:pd::text))::jsonb);
select tests.expect_error(
  format($$select public.admin_reopen_match(%L)$$, (select id from public.matches where plan_key = 'pool-A-1' and tournament_id = :t2)),
  'FINAL_PHASE_EXISTS', 'phase finale générée : annulation de poule figée');
reset role;

rollback;
\echo '✅ Tous les tests SQL des forfaits et annulations sont passés'
