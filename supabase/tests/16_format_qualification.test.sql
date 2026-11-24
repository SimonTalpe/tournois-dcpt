-- Tests du format « Qualification puis élimination directe » : appariements au fil de l'eau,
-- à la fin du round ou par l'admin, exempts, corrections, forfaits, phase finale.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set t1 '''10000000-0000-0000-0000-0000000000f1'''
\set t2 '''10000000-0000-0000-0000-0000000000f2'''
\set t3 '''10000000-0000-0000-0000-0000000000f3'''
\set t1r1 '''30000000-0000-0000-0000-0000000000f1'''
\set t1r2 '''30000000-0000-0000-0000-0000000000f2'''
\set t2r1 '''30000000-0000-0000-0000-0000000000f3'''
\set t2r2 '''30000000-0000-0000-0000-0000000000f4'''
\set t3r1 '''30000000-0000-0000-0000-0000000000f5'''
\set t3r2 '''30000000-0000-0000-0000-0000000000f6'''
\set p1 '''20000000-0000-0000-0000-0000000000f1'''
\set p2 '''20000000-0000-0000-0000-0000000000f2'''
\set p3 '''20000000-0000-0000-0000-0000000000f3'''
\set p4 '''20000000-0000-0000-0000-0000000000f4'''
\set p5 '''20000000-0000-0000-0000-0000000000f5'''
\set p6 '''20000000-0000-0000-0000-0000000000f6'''
\set p7 '''20000000-0000-0000-0000-0000000000f7'''
\set px '''20000000-0000-0000-0000-0000000000ff'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:p1, :alice_id, '--');
insert into public.players (id, full_name) values
  (:p2, 'Joueur 2'), (:p3, 'Joueur 3'), (:p4, 'Joueur 4'), (:p5, 'Joueur 5'), (:p6, 'Joueur 6'),
  (:p7, 'Joueur 7'), (:px, 'Remplaçant');

-- Réglages : tous obligatoires dans ce format ; pas de consolante.
select tests.expect_error(format($$insert into public.tournaments (name, discipline, format) values ('XX', 'mini_pong', 'qualification_knockout')$$),
  'tournaments_qualification_options', 'format à qualification sans réglages refusé');
select tests.expect_error(format($$insert into public.tournaments (name, discipline, format, consolation,
    qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage)
  values ('XX', 'mini_pong', 'qualification_knockout', true, 1, 2, 'continuous', 'preliminary')$$),
  'tournaments_qualification_no_consolation', 'pas de consolante dans ce format');
select tests.expect_error(format($$insert into public.tournaments (name, discipline, format,
    qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage, group_size, group_qualifiers)
  values ('XX', 'darts', 'qualification_knockout', 1, 2, 'continuous', 'groups', 3, 3)$$),
  'tournaments_group_options', 'parties à plusieurs : moins de qualifiés que de joueurs');

-- t1 : 7 joueurs, au fil de l'eau, 1 victoire / 2 défaites. Round 1 : 3 matchs + exempt (p7).
insert into public.tournaments (id, name, discipline, format, status, default_sets_to_win,
  qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage)
values (:t1, 'Qualif continue', 'mini_pong', 'qualification_knockout', 'in_progress', 1, 1, 2, 'continuous', 'preliminary');
insert into public.tournament_entries (tournament_id, player_id)
select :t1, x from unnest(array[:p1, :p2, :p3, :p4, :p5, :p6, :p7]::uuid[]) x;
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:t1r1, :t1, 'qualification', 1, 'Round 1', 1, 301, 'qualification-1'),
  (:t1r2, :t1, 'qualification', 2, 'Repêchage', 1, 301, 'qualification-2');
insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status, winner_player_id) values
  (:t1, :t1r1, 1, 'qualification-1-1', :p1, :p2, 'pending', null),
  (:t1, :t1r1, 2, 'qualification-1-2', :p3, :p4, 'pending', null),
  (:t1, :t1r1, 3, 'qualification-1-3', :p5, :p6, 'pending', null),
  (:t1, :t1r1, 4, 'qualification-1-4', :p7, null, 'bye', :p7);

create function pg_temp.round2(p_t uuid) returns table (home uuid, away uuid, status public.match_status)
language sql as $$
  select m.home_player_id, m.away_player_id, m.status from public.matches m
  join public.tournament_rounds r on r.id = m.round_id
  where m.tournament_id = p_t and r.bracket::text = 'qualification' and r.round_number = 2;
$$;
create function pg_temp.met(p_t uuid, a uuid, b uuid) returns boolean language sql as $$
  select exists (select 1 from public.matches m where m.tournament_id = p_t
    and ((m.home_player_id = a and m.away_player_id = b) or (m.home_player_id = b and m.away_player_id = a)));
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);

-- ---------------------------------------------------------------- Au fil de l'eau
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-1' and tournament_id = :t1),
  null, '[{"home": 5, "away": 11}]');
reset role;
select tests.assert((select count(*) from pg_temp.round2(:t1)) = 0, 'un seul perdant : il attend (des joueurs peuvent encore arriver)');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-2' and tournament_id = :t1),
  null, '[{"home": 11, "away": 9}]');
reset role;
select tests.assert(pg_temp.met(:t1, :p1, :p4) and (select count(*) from pg_temp.round2(:t1)) = 1,
  'deux perdants disponibles : match de repêchage créé aussitôt');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-3' and tournament_id = :t1),
  null, '[{"home": 11, "away": 3}]');
reset role;
select tests.assert(exists (select 1 from pg_temp.round2(:t1) where home = :p6 and away is null and status = 'bye'),
  'dernier perdant seul, plus personne ne peut arriver : exempt');

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_generate_qualification_final(%L, '{"pools":[],"rounds":[],"matches":[]}')$$, :t1),
  'FORBIDDEN', 'phase finale réservée à l''admin');
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_generate_qualification_final(%L, '{"pools":[],"rounds":[],"matches":[]}')$$, :t1),
  'QUALIFICATION_NOT_FINISHED', 'phase finale impossible avant la fin de la qualification');

-- Correction qui change le vainqueur : le match de repêchage non joué est refait.
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-2' and tournament_id = :t1),
  null, '[{"home": 9, "away": 11}]');
reset role;
select tests.assert(not pg_temp.met(:t1, :p1, :p4) and pg_temp.met(:t1, :p1, :p3),
  'correction : ancien match de repêchage supprimé, nouveau perdant apparié');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.submit_match_result((select m.id from public.matches m where m.tournament_id = :t1
  and m.home_player_id in (:p1, :p3) and m.away_player_id in (:p1, :p3)), null,
  case when (select home_player_id from public.matches m where m.tournament_id = :t1
    and m.home_player_id in (:p1, :p3) and m.away_player_id in (:p1, :p3)) = :p1
  then '[{"home": 11, "away": 7}]' else '[{"home": 7, "away": 11}]' end::jsonb);
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home": 11, "away": 9}]')$$,
  (select id from public.matches where plan_key = 'qualification-1-2' and tournament_id = :t1)),
  'NEXT_MATCH_PLAYED', 'correction refusée si le match suivant est joué');

reset role;
select tests.assert((select count(*) from public.qualification_records(:t1) where wins >= 1) = 6
  and (select count(*) from public.qualification_records(:t1) where losses >= 2) = 1
  and (select losses from public.qualification_records(:t1) where player_id = :p3) = 2,
  '7 joueurs : 6 qualifiés, 1 éliminé (2 défaites)');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_replace_player(%L, %L, %L)$$, :t1, :p3, :px),
  'QUALIFICATION_REPLACE_LOCKED', 'remplacement impossible après un résultat de qualification');

-- Phase finale : les joueurs du plan doivent être exactement les qualifiés.
select tests.expect_error(format($j$select public.admin_generate_qualification_final(%L, %L)$j$, :t1,
  format('{"pools":[],"rounds":[{"key":"main-1","bracket":"main","roundNumber":1,"name":"Finale"}],
    "matches":[{"key":"main-1-1","roundKey":"main-1","poolLabel":null,"position":1,"home":%s,"away":%s,
    "status":"pending","winner":null,"next":null,"loserNext":null}]}', to_jsonb(:p1::text), to_jsonb(:p2::text))),
  'INVALID_PLAN', 'plan sans tous les qualifiés refusé');
select public.admin_generate_qualification_final(:t1, format('{"pools":[],
  "rounds":[{"key":"main-1","bracket":"main","roundNumber":1,"name":"Quarts de finale"}],
  "matches":[
    {"key":"main-1-1","roundKey":"main-1","poolLabel":null,"position":1,"home":%s,"away":%s,"status":"pending","winner":null,"next":null,"loserNext":null},
    {"key":"main-1-2","roundKey":"main-1","poolLabel":null,"position":2,"home":%s,"away":%s,"status":"pending","winner":null,"next":null,"loserNext":null},
    {"key":"main-1-3","roundKey":"main-1","poolLabel":null,"position":3,"home":%s,"away":%s,"status":"pending","winner":null,"next":null,"loserNext":null}]}',
  to_jsonb(:p1::text), to_jsonb(:p2::text), to_jsonb(:p4::text), to_jsonb(:p5::text), to_jsonb(:p6::text), to_jsonb(:p7::text))::jsonb);
select tests.expect_error(format($$select public.submit_match_result(%L, null, '[{"home": 11, "away": 2}]')$$,
  (select id from public.matches where plan_key = 'qualification-1-1' and tournament_id = :t1)),
  'FINAL_PHASE_EXISTS', 'qualification figée une fois la phase finale générée');
select public.admin_reset_final_phase(:t1);
reset role;
select tests.assert((select count(*) from public.tournament_rounds where tournament_id = :t1) = 2
  and (select count(*) from public.matches m join public.tournament_rounds r on r.id = m.round_id
       where m.tournament_id = :t1 and r.bracket::text = 'qualification') = 6,
  'annuler la phase finale garde la qualification');

-- ---------------------------------------------------------------- À la fin du round, puis exempt modifié
insert into public.tournaments (id, name, discipline, format, status, default_sets_to_win,
  qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage)
values (:t2, 'Qualif par round', 'mini_pong', 'qualification_knockout', 'in_progress', 1, 1, 2, 'end_of_round', 'preliminary');
insert into public.tournament_entries (tournament_id, player_id)
select :t2, x from unnest(array[:p1, :p2, :p3, :p4, :p5, :p6]::uuid[]) x;
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:t2r1, :t2, 'qualification', 1, 'Round 1', 1, 301, 'qualification-1'),
  (:t2r2, :t2, 'qualification', 2, 'Repêchage', 1, 301, 'qualification-2');
insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:t2, :t2r1, 1, 'qualification-1-1', :p1, :p2),
  (:t2, :t2r1, 2, 'qualification-1-2', :p3, :p4),
  (:t2, :t2r1, 3, 'qualification-1-3', :p5, :p6);
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-1' and tournament_id = :t2),
  null, '[{"home": 11, "away": 5}]');
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-2' and tournament_id = :t2),
  null, '[{"home": 11, "away": 5}]');
reset role;
select tests.assert((select count(*) from pg_temp.round2(:t2)) = 0, 'fin de round : rien tant que le round n''est pas fini');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-3' and tournament_id = :t2),
  null, '[{"home": 11, "away": 5}]');
reset role;
select tests.assert((select count(*) from pg_temp.round2(:t2) where status = 'pending') = 1
  and (select count(*) from pg_temp.round2(:t2) where status = 'bye') = 1,
  'round terminé : 3 perdants → 1 match + 1 exempt');

-- Changer l'exempté : un joueur du match de repêchage prend l'exemption.
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
create temp table swap_case as
  select (select home from pg_temp.round2(:t2) where status = 'bye') as bye_player,
         (select home from pg_temp.round2(:t2) where status = 'pending') as other_player;
select public.admin_swap_qualification_bye(
  (select m.id from public.matches m where m.round_id = :t2r2 and m.status = 'bye'),
  (select other_player from swap_case));
reset role;
select tests.assert(
  (select home from pg_temp.round2(:t2) where status = 'bye') = (select other_player from swap_case)
  and exists (select 1 from pg_temp.round2(:t2) where status = 'pending'
              and (select bye_player from swap_case) in (home, away)),
  'exempt échangé : l''ancien exempté joue le repêchage');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_swap_qualification_bye(%L, %L)$$,
  (select m.id from public.matches m where m.round_id = :t2r2 and m.status = 'bye'), :p1),
  'BYE_SWAP_NOT_ALLOWED', 'exempt donné seulement à un joueur du même round');

-- ---------------------------------------------------------------- Par l'admin, forfaits
reset role;
insert into public.tournaments (id, name, discipline, format, status, default_sets_to_win,
  qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage)
values (:t3, 'Qualif manuelle', 'darts', 'qualification_knockout', 'in_progress', 1, 1, 2, 'manual', 'none');
insert into public.tournament_entries (tournament_id, player_id)
select :t3, x from unnest(array[:p1, :p2, :p3, :p4, :p5, :p6]::uuid[]) x;
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:t3r1, :t3, 'qualification', 1, 'Round 1', 1, 301, 'qualification-1'),
  (:t3r2, :t3, 'qualification', 2, 'Repêchage', 1, 301, 'qualification-2');
insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:t3, :t3r1, 1, 'qualification-1-1', :p1, :p2),
  (:t3, :t3r1, 2, 'qualification-1-2', :p3, :p4),
  (:t3, :t3r1, 3, 'qualification-1-3', :p5, :p6);
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_qualification_next_round(%L)$$, :t3),
  'ROUND_NOT_FINISHED', 'round suivant impossible tant que le round n''est pas fini');
select public.admin_forfeit_player(:t3, :p1);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-2' and tournament_id = :t3),
  :p3, null);
select public.submit_match_result((select id from public.matches where plan_key = 'qualification-1-3' and tournament_id = :t3),
  :p5, null);
reset role;
select tests.assert((select count(*) from pg_temp.round2(:t3)) = 0, 'par l''admin : aucun match créé automatiquement');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.assert(public.admin_qualification_next_round(:t3) = 2, 'bouton « round suivant » : 1 match + 1 exempt');
select public.admin_forfeit_player(:t3, :p1);
reset role;
select tests.assert(
  (select losses from public.qualification_records(:t3) where player_id = :p1) = 2
  or (select wins from public.qualification_records(:t3) where player_id = :p1) = 1,
  'forfait sur tous ses matchs : éliminé (ou exempté au repêchage)');

rollback;
\echo '✅ Tous les tests SQL du format à qualification sont passés'
