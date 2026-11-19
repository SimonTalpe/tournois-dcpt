-- Tests du compteur dans les matchs de tournoi : format (sortie double, manches), score en manches,
-- match et départage joués au compteur, droits, double validation, corrections.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set spect_id '''00000000-0000-0000-0000-00000000005e'''
\set t1  '''10000000-0000-0000-0000-000000000001'''
\set t2  '''10000000-0000-0000-0000-000000000002'''
\set r1  '''30000000-0000-0000-0000-000000000001'''
\set r2  '''30000000-0000-0000-0000-000000000002'''
\set rp  '''30000000-0000-0000-0000-000000000003'''
\set pa  '''20000000-0000-0000-0000-0000000000a1'''
\set pb  '''20000000-0000-0000-0000-0000000000b0'''
\set pd  '''20000000-0000-0000-0000-0000000000d0'''
\set a2  '''20000000-0000-0000-0000-0000000000a2'''
\set a3  '''20000000-0000-0000-0000-0000000000a3'''
\set pool_a '''50000000-0000-0000-0000-00000000000a'''
\set m1  '''40000000-0000-0000-0000-000000000001'''
\set m2  '''40000000-0000-0000-0000-000000000002'''
\set g1  '''60000000-0000-0000-0000-000000000001'''
\set g2  '''60000000-0000-0000-0000-000000000002'''
\set g3  '''60000000-0000-0000-0000-000000000003'''
\set g4  '''60000000-0000-0000-0000-000000000004'''
\set g5  '''60000000-0000-0000-0000-000000000005'''
\set g6  '''60000000-0000-0000-0000-000000000006'''
\set g7  '''60000000-0000-0000-0000-000000000007'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--');
insert into public.players (id, full_name) values (:pd, 'David Nom-Seul'), (:a2, 'A deux'), (:a3, 'A trois');

-- T1 : fléchettes, 2 manches gagnantes, 501, sortie double. M1 Alice–Bob → finale M2 contre David.
insert into public.tournaments (id, name, discipline, status, default_sets_to_win, default_dart_start, default_dart_double_out)
values (:t1, 'Fléchettes', 'darts', 'in_progress', 2, 501, true);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'main', 1, 'Demi-finale', 2, 501, 'main-1'),
  (:r2, :t1, 'main', 2, 'Finale', 2, 501, 'main-2');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb), (:t1, :pd);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status) values
  (:m2, :t1, :r2, 1, 'main-2-1', null, :pd, 'pending'),
  (:m1, :t1, :r1, 1, 'main-1-1', :pa, :pb, 'pending');
update public.matches set next_match_id = :m2, next_slot = 'home' where id = :m1;

-- T2 : fléchettes à poules (301, sans double), poule A en cycle a1 > a2 > a3 > a1 : égalité à trois.
insert into public.tournaments (id, name, discipline, format, status, pool_count, qualifiers_per_pool)
values (:t2, 'Fléchettes à poules', 'darts', 'pools_knockout', 'in_progress', 1, 1);
insert into public.pools (id, tournament_id, label) values (:pool_a, :t2, 'A');
insert into public.tournament_entries (tournament_id, player_id, pool_id) values
  (:t2, :pa, :pool_a), (:t2, :a2, :pool_a), (:t2, :a3, :pool_a);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:rp, :t2, 'pool', 1, 'Poules', 1, 301, 'pool-1');
insert into public.matches (tournament_id, round_id, pool_id, position, plan_key, home_player_id, away_player_id, status, winner_player_id) values
  (:t2, :rp, :pool_a, 1, 'pool-A-1', :pa, :a2, 'played', :pa),
  (:t2, :rp, :pool_a, 2, 'pool-A-2', :a2, :a3, 'played', :a2),
  (:t2, :rp, :pool_a, 3, 'pool-A-3', :a3, :pa, 'played', :a3);

-- Manches d'un match (joueurs dans l'ordre de jeu de la manche).
create temp table legs (name text primary key, j jsonb);
insert into legs values
  -- Alice gagne 2-1 : manche 1 Alice, manche 2 Bob (Bob commence), manche 3 Alice.
  ('ok', format($j$[
    {"game_id": %1$s, "started_at": %4$s, "players": [
      {"player_id": %5$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501},
      {"player_id": %6$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461}]},
    {"game_id": %2$s, "started_at": %4$s, "players": [
      {"player_id": %6$s, "rank": 1, "remaining": 0, "darts": 18, "points": 501},
      {"player_id": %5$s, "rank": 2, "remaining": 32, "darts": 15, "points": 469}]},
    {"game_id": %3$s, "started_at": %4$s, "players": [
      {"player_id": %5$s, "rank": 1, "remaining": 0, "darts": 24, "points": 501},
      {"player_id": %6$s, "rank": 2, "remaining": 101, "darts": 24, "points": 400}]}
  ]$j$, to_json(:g1::text), to_json(:g2::text), to_json(:g3::text), to_json((now() - interval '20 minutes')::text),
     to_json(:pa::text), to_json(:pb::text))::jsonb),
  -- Une seule manche gagnée sur deux nécessaires.
  ('short', format($j$[{"game_id": %1$s, "started_at": %2$s, "players": [
      {"player_id": %3$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501},
      {"player_id": %4$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461}]}]$j$,
     to_json(:g4::text), to_json(now()::text), to_json(:pa::text), to_json(:pb::text))::jsonb),
  -- Un joueur hors du match.
  ('intruder', format($j$[{"game_id": %1$s, "started_at": %2$s, "players": [
      {"player_id": %3$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501},
      {"player_id": %4$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461}]},
    {"game_id": %5$s, "started_at": %2$s, "players": [
      {"player_id": %3$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501},
      {"player_id": %4$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461}]}]$j$,
     to_json(:g4::text), to_json(now()::text), to_json(:pa::text), to_json(:pd::text), to_json(:g5::text))::jsonb),
  -- Même match vu d'un autre téléphone : Bob gagne 2-0 (nouveaux identifiants).
  ('other', format($j$[{"game_id": %1$s, "started_at": %2$s, "players": [
      {"player_id": %4$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501},
      {"player_id": %3$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461}]},
    {"game_id": %5$s, "started_at": %2$s, "players": [
      {"player_id": %3$s, "rank": 2, "remaining": 40, "darts": 21, "points": 461},
      {"player_id": %4$s, "rank": 1, "remaining": 0, "darts": 21, "points": 501}]}]$j$,
     to_json(:g4::text), to_json(now()::text), to_json(:pa::text), to_json(:pb::text), to_json(:g5::text))::jsonb);
grant select on legs to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Format de jeu
select tests.assert((select bool_and(dart_double_out) from public.tournament_rounds where tournament_id = :t1),
  'sortie sur double du tournoi recopiée dans ses tours');
select tests.assert((select not dart_double_out from public.tournament_rounds where id = :rp),
  'tournoi sans sortie double : tours sans sortie double');
select set_config('request.jwt.claim.sub', :alice_id, true);
update public.tournament_rounds set dart_double_out = false where id = :r2;
select tests.assert((select dart_double_out from public.tournament_rounds where id = :r2), 'joueur : format d''un tour non modifiable');

-- ---------------------------------------------------------------- Match au compteur : refus
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m1, (select j from legs where name = 'ok')),
  'FORBIDDEN', 'spectateur : compteur de match interdit');
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m1, (select j from legs where name = 'ok')),
  'NOT_MY_MATCH', 'joueur hors du match : compteur de match interdit');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m1, (select j from legs where name = 'short')),
  'INVALID_DART_MATCH', 'match non terminé (1 manche sur 2) : refusé');
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m1, (select j from legs where name = 'intruder')),
  'INVALID_DART_MATCH', 'joueur étranger au match : refusé');
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m2, (select j from legs where name = 'ok')),
  'MATCH_NOT_READY', 'match dont un joueur n''est pas connu : refusé');
select tests.assert((select count(*) from public.dart_games) = 0, 'refus : aucune partie enregistrée');

-- ---------------------------------------------------------------- Match au compteur : enregistrement
select public.record_dart_match(:m1, (select j from legs where name = 'ok'));
select tests.assert((select status = 'played' and winner_player_id = :pa::uuid and home_legs = 2 and away_legs = 1
  and result_by = :alice_id::uuid and not result_by_admin from public.matches where id = :m1),
  'résultat reporté dans le match : Alice gagne 2 manches à 1');
select tests.assert((select home_player_id = :pa::uuid from public.matches where id = :m2), 'vainqueur qualifié pour la finale');
select tests.assert((select array_agg(leg_number order by leg_number) = array[1, 2, 3]::smallint[]
  and bool_and(start_score = 501 and double_out and status = 'finished' and created_by = :alice_id::uuid)
  from public.dart_games where match_id = :m1), 'trois manches enregistrées au format du tour (501, sortie double)');
select tests.assert((select rank = 2 and remaining = 32 and not finished from public.dart_game_players
  where game_id = :g2 and player_id = :pa), 'détail des manches conservé (reste du perdant)');

-- Nouvel essai (coupure réseau) : rien n'est dupliqué.
select public.record_dart_match(:m1, (select j from legs where name = 'ok'));
select tests.assert((select count(*) from public.dart_games) = 3, 'nouvel essai : pas de doublon');

-- Bob avait aussi lancé le compteur : le premier qui valide l'emporte.
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.record_dart_match(%L, %L)$$, :m1, (select j from legs where name = 'other')),
  'MATCH_ALREADY_PLAYED', 'second téléphone : match déjà joué, résultat refusé');
select tests.assert((select winner_player_id = :pa::uuid from public.matches where id = :m1), 'premier résultat conservé');

-- Format verrouillé une fois un match du tour joué.
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$update public.tournament_rounds set dart_double_out = false where id = %L$$, :r1),
  'ROUND_LOCKED', 'sortie double verrouillée après un match joué');
update public.tournament_rounds set dart_double_out = false, sets_to_win = 3 where id = :r2;
select tests.assert((select not dart_double_out and sets_to_win = 3 from public.tournament_rounds where id = :r2),
  'admin : format d''un tour non joué modifiable (sortie double, manches)');

-- ---------------------------------------------------------------- Saisie manuelle en manches
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '{"home": 2, "away": 2}')$$, :m1),
  'INVALID_LEGS', 'manches : deux vainqueurs refusés');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '{"home": 1, "away": 0}')$$, :m1),
  'INVALID_LEGS', 'manches : vainqueur sans le nombre de manches requis');
select tests.expect_error(format($$select public.submit_match_result(%L, %L, null)$$, :m1, :pa),
  'INVALID_LEGS', 'vainqueur seul refusé quand il faut plusieurs manches');
-- Correction manuelle par l'auteur : les parties du compteur sont détachées du match.
select public.submit_match_result(:m1, null, '{"home": 0, "away": 2}');
select tests.assert((select winner_player_id = :pb::uuid and home_legs = 0 and away_legs = 2 from public.matches where id = :m1),
  'correction manuelle : Bob gagne 2-0');
select tests.assert((select home_player_id = :pb::uuid from public.matches where id = :m2), 'correction : finale mise à jour');
select tests.assert(not exists (select 1 from public.dart_games where match_id = :m1)
  and (select count(*) from public.dart_games) = 3, 'correction : manches détachées du match, gardées dans l''historique');
select public.clear_match_result(:m1);
select tests.assert((select status = 'pending' and home_legs is null and away_legs is null from public.matches where id = :m1),
  'effacement : score en manches effacé');

-- Rejouer au compteur après effacement.
select public.record_dart_match(:m1, (select j from legs where name = 'other'));
select tests.assert((select winner_player_id = :pb::uuid and home_legs = 0 and away_legs = 2 from public.matches where id = :m1),
  'match rejoué au compteur après effacement');
select tests.assert((select count(*) from public.dart_games where match_id = :m1) = 2, 'nouvelles manches liées au match');

-- ---------------------------------------------------------------- Départage au compteur
select tests.expect_error(format($$select public.record_dart_tiebreak(%L, %L, now(), %L)$$, :pool_a, :g6,
  format('[{"player_id": %s, "rank": 1, "remaining": 0, "darts": 30, "points": 301},
           {"player_id": %s, "rank": 2, "remaining": 50, "darts": 30, "points": 251},
           {"player_id": %s, "rank": 2, "remaining": 50, "darts": 30, "points": 251}]',
         to_json(:pa::text), to_json(:a2::text), to_json(:a3::text))),
  'INVALID_DART_GAME', 'départage : ex aequo refusé (partie jouée jusqu''au bout)');
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.record_dart_tiebreak(%L, %L, now(), %L)$$, :pool_a, :g6,
  format('[{"player_id": %s, "rank": 2, "remaining": 0, "darts": 30, "points": 301},
           {"player_id": %s, "rank": 1, "remaining": 0, "darts": 27, "points": 301},
           {"player_id": %s, "rank": 3, "remaining": 50, "darts": 30, "points": 251}]',
         to_json(:pa::text), to_json(:a2::text), to_json(:a3::text))),
  'NOT_MY_MATCH', 'départage : joueur non concerné refusé');
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.record_dart_tiebreak(:pool_a, :g6, now() - interval '5 minutes',
  format('[{"player_id": %s, "rank": 2, "remaining": 0, "darts": 30, "points": 301},
           {"player_id": %s, "rank": 1, "remaining": 0, "darts": 27, "points": 301},
           {"player_id": %s, "rank": 3, "remaining": 50, "darts": 30, "points": 251}]',
         to_json(:pa::text), to_json(:a2::text), to_json(:a3::text))::jsonb);
select tests.assert((select ranking = array[:a2, :pa, :a3]::uuid[] and result_by = :alice_id::uuid
  from public.pool_tiebreaks where pool_id = :pool_a), 'départage enregistré dans l''ordre d''arrivée');
select tests.assert((select g.tiebreak_id = t.id and g.start_score = 301 and not g.double_out and g.player_count = 3
  from public.dart_games g join public.pool_tiebreaks t on t.pool_id = :pool_a where g.id = :g6),
  'partie de départage liée au départage, au format de la poule');
select public.record_dart_tiebreak(:pool_a, :g6, now(), '[]'::jsonb);
select tests.assert((select count(*) from public.pool_tiebreaks where pool_id = :pool_a) = 1, 'départage : nouvel essai sans doublon');
select tests.expect_error(format($$select public.record_dart_tiebreak(%L, %L, now(), %L)$$, :pool_a, :g7,
  format('[{"player_id": %s, "rank": 1, "remaining": 0, "darts": 30, "points": 301},
           {"player_id": %s, "rank": 2, "remaining": 0, "darts": 27, "points": 301},
           {"player_id": %s, "rank": 3, "remaining": 50, "darts": 30, "points": 251}]',
         to_json(:pa::text), to_json(:a2::text), to_json(:a3::text))),
  'TIEBREAK_ALREADY_SET', 'départage déjà saisi : second téléphone refusé');
-- Correction manuelle : la partie est détachée du départage.
select public.submit_pool_tiebreak(:pool_a, array[:pa, :a2, :a3]::uuid[]);
select tests.assert((select tiebreak_id is null from public.dart_games where id = :g6), 'correction manuelle : partie détachée');

-- ---------------------------------------------------------------- Lecture
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select home_legs from public.matches where id = :m1) = 0, 'spectateur : score en manches visible');
select tests.assert((select count(*) from public.dart_games) = 0, 'spectateur : détail des manches non lisible');

rollback;
\echo '✅ Tous les tests SQL du compteur dans les matchs sont passés'
