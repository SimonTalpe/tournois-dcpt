-- Tests de l'étape 4 : saisie des scores, corrections, avancement automatique.

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
\set rc1 '''30000000-0000-0000-0000-000000000003'''
\set rc2 '''30000000-0000-0000-0000-000000000004'''
\set rd  '''30000000-0000-0000-0000-000000000005'''
\set pa  '''20000000-0000-0000-0000-0000000000a1'''
\set pb  '''20000000-0000-0000-0000-0000000000b0'''
\set pc  '''20000000-0000-0000-0000-000000000003'''
\set pd  '''20000000-0000-0000-0000-000000000004'''
\set m1  '''40000000-0000-0000-0000-000000000001'''
\set m2  '''40000000-0000-0000-0000-000000000002'''
\set m3  '''40000000-0000-0000-0000-000000000003'''
\set c1  '''40000000-0000-0000-0000-000000000004'''
\set c2  '''40000000-0000-0000-0000-000000000005'''
\set d1  '''40000000-0000-0000-0000-000000000006'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;

insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--');
insert into public.players (id, full_name) values (:pc, 'Chloé Nom-Seul'), (:pd, 'David Nom-Seul');

-- T1 (mini-pong, 2 sets gagnants) : M1 Alice–Bob, M2 Chloé–David → finale M3.
-- Consolante : perdant M1 → C1 (exempt, qualifié d'office) → C2 ; perdant M2 → C2.
insert into public.tournaments (id, name, discipline, status, consolation) values
  (:t1, 'Mini-pong', 'mini_pong', 'in_progress', true),
  (:t2, 'Fléchettes', 'darts', 'in_progress', false);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'main', 1, 'Demi-finales', 2, 301, 'main-1'),
  (:r2, :t1, 'main', 2, 'Finale', 2, 301, 'main-2'),
  (:rc1, :t1, 'consolation', 1, 'Consolante — demi-finales', 2, 301, 'consolation-1'),
  (:rc2, :t1, 'consolation', 2, 'Consolante — finale', 2, 301, 'consolation-2'),
  (:rd, :t2, 'main', 1, 'Finale', 1, 501, 'main-1');
insert into public.tournament_entries (tournament_id, player_id) values
  (:t1, :pa), (:t1, :pb), (:t1, :pc), (:t1, :pd), (:t2, :pa), (:t2, :pc);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status) values
  (:m3, :t1, :r2, 1, 'main-2-1', null, null, 'pending'),
  (:c2, :t1, :rc2, 1, 'consolation-2-1', null, null, 'pending'),
  (:c1, :t1, :rc1, 1, 'consolation-1-1', null, null, 'bye'),
  (:m1, :t1, :r1, 1, 'main-1-1', :pa, :pb, 'pending'),
  (:m2, :t1, :r1, 2, 'main-1-2', :pc, :pd, 'pending'),
  (:d1, :t2, :rd, 1, 'main-1-1', :pa, :pc, 'pending');
update public.matches set next_match_id = :m3, next_slot = 'home', loser_next_match_id = :c1, loser_next_slot = 'home' where id = :m1;
update public.matches set next_match_id = :m3, next_slot = 'away', loser_next_match_id = :c2, loser_next_slot = 'away' where id = :m2;
update public.matches set next_match_id = :c2, next_slot = 'home' where id = :c1;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Droits
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":3},{"home":11,"away":3}]')$$, :m1),
  'FORBIDDEN', 'spectateur : saisie interdite');
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":3},{"home":11,"away":3}]')$$, :m1),
  'NOT_MY_MATCH', 'joueur hors du match : saisie interdite');
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":3},{"home":11,"away":3}]')$$, :m3),
  'MATCH_NOT_READY', 'match dont les joueurs ne sont pas connus : saisie impossible');

-- ---------------------------------------------------------------- Validité des scores (mini-pong)
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":10},{"home":11,"away":3}]')$$, :m1),
  'INVALID_SCORE', 'set sans 2 points d''écart refusé');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":12,"away":9},{"home":11,"away":3}]')$$, :m1),
  'INVALID_SCORE', 'set au-delà de 11 sans écart de 2 exactement refusé');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":5}]')$$, :m1),
  'INVALID_SCORE', 'match inachevé refusé');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":5},{"home":11,"away":3},{"home":3,"away":11}]')$$, :m1),
  'INVALID_SCORE', 'set après la victoire refusé');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[]')$$, :m1),
  'INVALID_SCORE', 'aucun set refusé');

-- ---------------------------------------------------------------- Saisie et avancement
select public.submit_match_result(:m1, :pb, '[{"home":11,"away":5},{"home":9,"away":11},{"home":13,"away":11}]');
select tests.assert(
  (select status = 'played' and winner_player_id = :pa::uuid and result_by = :alice_id::uuid and not result_by_admin
   from public.matches where id = :m1),
  'saisie par un joueur : vainqueur déduit des sets (paramètre vainqueur ignoré), auteur tracé');
select tests.assert((select count(*) from public.match_sets where match_id = :m1) = 3, '3 sets enregistrés');
select tests.assert((select home_player_id from public.matches where id = :m3) = :pa::uuid, 'vainqueur placé en finale');
select tests.assert(
  (select home_player_id = :pb::uuid and winner_player_id = :pb::uuid from public.matches where id = :c1),
  'perdant envoyé en consolante dans un match exempt : qualifié d''office');
select tests.assert((select home_player_id from public.matches where id = :c2) = :pb::uuid,
  'exempt de consolante : le perdant poursuit au tour suivant');

-- Correction par l'auteur dans les 5 minutes (le vainqueur change)
select public.submit_match_result(:m1, null, '[{"home":5,"away":11},{"home":9,"away":11}]');
select tests.assert(
  (select winner_player_id from public.matches where id = :m1) = :pb::uuid
  and (select home_player_id from public.matches where id = :m3) = :pb::uuid
  and (select home_player_id from public.matches where id = :c2) = :pa::uuid,
  'correction : avancement refait (finale et consolante)');
select tests.assert((select count(*) from public.match_sets where match_id = :m1) = 2, 'correction : sets remplacés');

select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":5},{"home":11,"away":5}]')$$, :m1),
  'RESULT_LOCKED', 'adversaire : correction du résultat saisi par l''autre interdite');

reset role;
update public.matches set result_first_at = now() - interval '6 minutes' where id = :m1;
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":5},{"home":11,"away":5}]')$$, :m1),
  'RESULT_LOCKED', 'auteur : correction impossible après 5 minutes');
select tests.expect_error(format($$select public.clear_match_result(%L)$$, :m1),
  'RESULT_LOCKED', 'auteur : effacement impossible après 5 minutes');

-- Format de jeu verrouillé dès qu'un match du tour est joué
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$update public.tournament_rounds set sets_to_win = 3 where id = %L$$, :r1),
  'ROUND_LOCKED', 'format d''un tour avec un match joué : verrouillé');
update public.tournament_rounds set sets_to_win = 3 where id = :r2;
select tests.assert((select sets_to_win from public.tournament_rounds where id = :r2) = 3, 'format de la finale encore modifiable');

-- L'admin corrige : le résultat devient non modifiable par les joueurs
select public.submit_match_result(:m1, null, '[{"home":11,"away":5},{"home":11,"away":5}]');
select tests.assert((select result_by_admin and winner_player_id = :pa::uuid from public.matches where id = :m1),
  'correction admin tracée');
reset role;
update public.matches set result_first_at = now() where id = :m1;
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":11,"away":5},{"home":11,"away":7}]')$$, :m1),
  'RESULT_LOCKED', 'résultat saisi par l''admin : non modifiable par le joueur');

-- Noms seuls : saisie par l'admin ; finale complète
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result(:m2, null, '[{"home":11,"away":2},{"home":11,"away":2}]');
select tests.assert(
  (select away_player_id from public.matches where id = :m3) = :pc::uuid
  and (select away_player_id from public.matches where id = :c2) = :pd::uuid,
  'deuxième demi-finale : vainqueur en finale, perdant en consolante');
select public.submit_match_result(:m3, null, '[{"home":11,"away":2},{"home":3,"away":11},{"home":11,"away":9},{"home":11,"away":7}]');
select tests.assert((select winner_player_id from public.matches where id = :m3) = :pa::uuid,
  'finale en 3 sets gagnants (format du tour) : 4 sets');
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home":2,"away":11},{"home":2,"away":11}]')$$, :m1),
  'NEXT_MATCH_PLAYED', 'changement de vainqueur impossible si le match suivant est joué');
select public.submit_match_result(:m1, null, '[{"home":11,"away":8},{"home":11,"away":9}]');
select tests.assert((select winner_player_id from public.matches where id = :m1) = :pa::uuid,
  'correction des sets sans changement de vainqueur possible');

select public.clear_match_result(:m3);
select tests.assert(
  (select status = 'pending' and winner_player_id is null and result_by is null from public.matches where id = :m3)
  and not exists (select 1 from public.match_sets where match_id = :m3),
  'effacement du résultat : match à rejouer');
select public.submit_match_result(:m1, null, '[{"home":2,"away":11},{"home":2,"away":11}]');
select tests.assert((select home_player_id from public.matches where id = :m3) = :pb::uuid,
  'après effacement de la finale : vainqueur de la demi-finale modifiable');

-- ---------------------------------------------------------------- Fléchettes
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, %L, '[{"home":11,"away":2}]')$$, :d1, :pa),
  'INVALID_SCORE', 'fléchettes : pas de sets');
select tests.expect_error(format($$select public.submit_match_result(%L, %L, null)$$, :d1, :pb),
  'INVALID_SCORE', 'fléchettes : vainqueur hors du match refusé');
select public.submit_match_result(:d1, :pc, null);
select tests.assert((select winner_player_id from public.matches where id = :d1) = :pc::uuid,
  'fléchettes : vainqueur saisi par l''adversaire d''un nom seul');

-- ---------------------------------------------------------------- Tournoi terminé
reset role;
update public.tournaments set status = 'finished' where id = :t2;
set local role authenticated;
select tests.expect_error(format($$select public.submit_match_result(%L, %L, null)$$, :d1, :pa),
  'TOURNAMENT_CLOSED', 'tournoi terminé : saisie joueur impossible');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result(:d1, :pa, null);
select tests.assert((select winner_player_id from public.matches where id = :d1) = :pa::uuid,
  'tournoi terminé : l''admin peut encore corriger');

-- ---------------------------------------------------------------- Lecture
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.match_sets) > 0, 'spectateur : scores visibles');
select tests.expect_error($$insert into public.match_sets values ('40000000-0000-0000-0000-000000000003', 1, 11, 0)$$,
  'permission denied', 'écriture directe des sets interdite');
reset role;

rollback;
\echo '✅ Tous les tests SQL de la saisie des scores sont passés'
