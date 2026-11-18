-- Campagne de tests de l'étape 4 : cas limites entre fonctionnalités.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set t1 '''10000000-0000-0000-0000-000000000001'''
\set t2 '''10000000-0000-0000-0000-000000000002'''
\set rp '''30000000-0000-0000-0000-000000000001'''
\set pool_a '''50000000-0000-0000-0000-00000000000a'''
\set pa '''20000000-0000-0000-0000-0000000000a1'''
\set n1 '''20000000-0000-0000-0000-000000000001'''
\set n2 '''20000000-0000-0000-0000-000000000002'''
\set n3 '''20000000-0000-0000-0000-000000000003'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
-- Alice a déjà une fiche (tournoi T2) ; « Alice (nom seul) » = n1 joue la poule de T1.
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--');
insert into public.players (id, full_name) values (:n1, 'Alice (nom seul)'), (:n2, 'Bruno'), (:n3, 'Chloé');
insert into public.tournaments (id, name, discipline, format, status, pool_count, qualifiers_per_pool) values
  (:t1, 'Fléchettes', 'darts', 'pools_knockout', 'in_progress', 1, 1),
  (:t2, 'Autre', 'darts', 'knockout', 'in_progress', null, null);
insert into public.pools (id, tournament_id, label) values (:pool_a, :t1, 'A');
insert into public.tournament_entries (tournament_id, player_id, pool_id) values
  (:t1, :n1, :pool_a), (:t1, :n2, :pool_a), (:t1, :n3, :pool_a), (:t2, :pa, null);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:rp, :t1, 'pool', 1, 'Poules', 1, 301, 'pool-1');
insert into public.matches (tournament_id, round_id, pool_id, position, plan_key, home_player_id, away_player_id, winner_player_id, status) values
  (:t1, :rp, :pool_a, 1, 'pool-A-1', :n1, :n2, :n1, 'played'),
  (:t1, :rp, :pool_a, 2, 'pool-A-2', :n2, :n3, :n2, 'played'),
  (:t1, :rp, :pool_a, 3, 'pool-A-3', :n3, :n1, :n3, 'played');

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_pool_tiebreak(:pool_a, array[:n2, :n1, :n3]::uuid[]);

-- Fusion du nom seul dans la fiche d'Alice : le départage suit.
select public.admin_link_player_to_account(:n1, :alice_id);
select tests.assert(
  (select ranking = array[:n2, :pa, :n3]::uuid[] from public.pool_tiebreaks where pool_id = :pool_a)
  and (select player_ids = (select array_agg(x order by x) from unnest(array[:n2, :pa, :n3]::uuid[]) x)
       from public.pool_tiebreaks where pool_id = :pool_a),
  'fusion nom seul → compte : départage de poule transféré (classement et groupe)');

-- ---------------------------------------------------------------- Scénarios croisés (tournoi à élimination directe)
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set t3 '''10000000-0000-0000-0000-000000000003'''
\set t4 '''10000000-0000-0000-0000-000000000004'''
\set r3 '''30000000-0000-0000-0000-000000000003'''
\set r4 '''30000000-0000-0000-0000-000000000004'''
\set pool_m '''50000000-0000-0000-0000-00000000000c'''
\set pb '''20000000-0000-0000-0000-0000000000b0'''
\set pc '''20000000-0000-0000-0000-0000000000c0'''
\set n4 '''20000000-0000-0000-0000-000000000004'''
\set n5 '''20000000-0000-0000-0000-000000000005'''
\set m1 '''40000000-0000-0000-0000-000000000001'''
\set m2 '''40000000-0000-0000-0000-000000000002'''
\set m3 '''40000000-0000-0000-0000-000000000003'''

reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
insert into public.players (id, profile_id, full_name) values (:pb, :bob_id, '--'), (:pc, :carol_id, '--');
insert into public.players (id, full_name) values (:n4, 'Damien'), (:n5, 'Élise');
insert into public.tournaments (id, name, discipline, status) values (:t3, 'Mini-pong', 'mini_pong', 'in_progress');
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r3, :t3, 'main', 1, 'Demi-finales', 1, 301, 'main-1'), (:r4, :t3, 'main', 2, 'Finale', 1, 301, 'main-2');
insert into public.tournament_entries (tournament_id, player_id) values (:t3, :pb), (:t3, :pc), (:t3, :n4), (:t3, :n5);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:m3, :t3, :r4, 1, 'main-2-1', null, null),
  (:m1, :t3, :r3, 1, 'main-1-1', :pb, :pc),
  (:m2, :t3, :r3, 2, 'main-1-2', :n4, :n5);
update public.matches set next_match_id = :m3, next_slot = 'home' where id = :m1;
update public.matches set next_match_id = :m3, next_slot = 'away' where id = :m2;

set local role authenticated;

-- Saisies simultanées : le 2e joueur ne peut pas écraser le résultat du 1er.
select set_config('request.jwt.claim.sub', :bob_id, true);
select public.submit_match_result(:m1, null, '[{"home":11,"away":4}]');
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":4,"away":11}]')$$, :m1),
  'RESULT_LOCKED', 'saisies simultanées : le second joueur ne peut pas écraser le premier résultat');

-- Score non entier refusé
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11.5,"away":4}]')$$, :m2),
  'invalid input syntax', 'score non entier refusé');

-- Remplacement en cours de tournoi : le remplaçant (compte) peut saisir, le remplacé non.
select public.admin_link_player_to_account(:n4, :alice_id);
select tests.assert((select home_player_id from public.matches where id = :m2) = :pa::uuid,
  'rattachement d''un nom seul en cours de tournoi : son match à venir passe au compte (fiche existante fusionnée)');
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.set_match_schedule(:m2, '2026-12-02 12:30:00+01', null);
select tests.assert((select scheduled_at is not null from public.matches where id = :m2),
  'après rattachement : le compte peut fixer l''horaire de son match');

-- Remplacement en cours de tournoi : le remplaçant (compte) peut saisir, le remplacé non.
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('00000000-0000-0000-0000-0000000000d0', 'dave@fft.fr', '{"full_name":"Dave Roux"}', now());
insert into public.players (id, profile_id, full_name)
values ('20000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000d0', '--');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_replace_player(:t3, :pa, '20000000-0000-0000-0000-0000000000d0');
select tests.assert(
  (select home_player_id = '20000000-0000-0000-0000-0000000000d0'::uuid and scheduled_at is not null from public.matches where id = :m2),
  'remplacement : le remplaçant reprend le match (horaire conservé)');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":4}]')$$, :m2),
  'NOT_MY_MATCH', 'joueur remplacé : saisie interdite');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d0', true);
select public.submit_match_result(:m2, null, '[{"home":11,"away":4}]');
select tests.assert((select away_player_id from public.matches where id = :m3) = '20000000-0000-0000-0000-0000000000d0'::uuid,
  'remplaçant : résultat saisi et vainqueur avancé en finale');

-- Compte désactivé : plus de saisie ni d'horaire ; son adversaire et l'admin le peuvent.
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_account_status(:bob_id, 'disabled');
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.set_match_schedule(%L, null, null)$$, :m3),
  'FORBIDDEN', 'compte désactivé : horaire interdit');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":4}]')$$, :m3),
  'FORBIDDEN', 'compte désactivé : saisie interdite');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d0', true);
select public.submit_match_result(:m3, null, '[{"home":4,"away":11}]');
select tests.assert((select winner_player_id from public.matches where id = :m3) = '20000000-0000-0000-0000-0000000000d0'::uuid,
  'adversaire d''un compte désactivé : saisie possible');

-- Départage : un joueur de mini-pong ne peut pas fixer une égalité parfaite (admin seul).
reset role;
insert into public.tournaments (id, name, discipline, format, status, pool_count, qualifiers_per_pool)
values (:t4, 'Mini-pong poules', 'mini_pong', 'pools_knockout', 'in_progress', 1, 1);
insert into public.pools (id, tournament_id, label) values (:pool_m, :t4, 'A');
insert into public.tournament_entries (tournament_id, player_id, pool_id) values (:t4, :pb, :pool_m), (:t4, :pc, :pool_m);
set local role authenticated;
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L]::uuid[])$$, :pool_m, :pc, :pb),
  'FORBIDDEN', 'mini-pong : départage par un joueur interdit');

-- Tournoi terminé, rouvert : la saisie joueur redevient possible ; archivé : même l'admin ne peut plus.
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_tournament_status(:t3, 'finished');
select public.admin_set_tournament_status(:t3, 'archived');
select tests.expect_error(format($$select public.clear_match_result(%L)$$, :m3), 'TOURNAMENT_CLOSED',
  'tournoi archivé : résultats figés, même pour l''admin');
select tests.expect_error(format($$select public.set_match_schedule(%L, null, null)$$, :m3), 'TOURNAMENT_CLOSED',
  'tournoi archivé : horaires figés, même pour l''admin');

-- Suppression d'un tournoi avec résultats : sets et matchs supprimés avec lui.
delete from public.tournaments where id = :t3;
select tests.assert(not exists (select 1 from public.matches where tournament_id = :t3), 'suppression : matchs supprimés');
reset role;
select tests.assert(not exists (select 1 from public.match_sets s where not exists (select 1 from public.matches m where m.id = s.match_id)),
  'suppression : aucun score orphelin');
delete from public.tournaments where id = :t1;
select tests.assert(not exists (select 1 from public.pool_tiebreaks), 'suppression : départages supprimés');
set local role authenticated;
reset role;

rollback;
\echo '✅ Tous les tests SQL de la campagne de l''étape 4 sont passés'
