-- Tests de l'étape 4 : lieu et horaire, lieux, inversion domicile/extérieur.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set spect_id '''00000000-0000-0000-0000-00000000005e'''
\set t1 '''10000000-0000-0000-0000-000000000001'''
\set r1 '''30000000-0000-0000-0000-000000000001'''
\set r2 '''30000000-0000-0000-0000-000000000002'''
\set pa '''20000000-0000-0000-0000-0000000000a1'''
\set pb '''20000000-0000-0000-0000-0000000000b0'''
\set pc '''20000000-0000-0000-0000-000000000003'''
\set pd '''20000000-0000-0000-0000-000000000004'''
\set m1 '''40000000-0000-0000-0000-000000000001'''
\set m2 '''40000000-0000-0000-0000-000000000002'''
\set m3 '''40000000-0000-0000-0000-000000000003'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--');
insert into public.players (id, full_name) values (:pc, 'Chloé'), (:pd, 'David');
insert into public.tournaments (id, name, discipline, status) values (:t1, 'Fléchettes', 'darts', 'in_progress');
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'main', 1, 'Demi-finales', 1, 301, 'main-1'), (:r2, :t1, 'main', 2, 'Finale', 1, 301, 'main-2');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb), (:t1, :pc), (:t1, :pd);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:m3, :t1, :r2, 1, 'main-2-1', null, null),
  (:m1, :t1, :r1, 1, 'main-1-1', :pa, :pb),
  (:m2, :t1, :r1, 2, 'main-1-2', :pc, :pd);
update public.matches set next_match_id = :m3, next_slot = 'home' where id = :m1;
update public.matches set next_match_id = :m3, next_slot = 'away' where id = :m2;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Lieux
select tests.assert((select count(*) from public.locations) = 2, 'spectateur : lieux par défaut visibles');
select tests.expect_error($$insert into public.locations (name) values ('Cafétéria')$$, 'row-level security',
  'spectateur : ajout de lieu interdit');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error($$insert into public.locations (name) values ('Cafétéria')$$, 'row-level security',
  'joueur : ajout de lieu interdit');
select set_config('request.jwt.claim.sub', :admin_id, true);
insert into public.locations (name) values ('Cafétéria');
select tests.expect_error($$insert into public.locations (name) values ('Cafétéria')$$, 'duplicate key',
  'lieu en double refusé');

-- ---------------------------------------------------------------- Horaire et lieu
-- 2 décembre 2026 = mercredi ; 5 décembre = samedi. 12:30 heure de Paris = 11:30 UTC.
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.set_match_schedule(:m1, '2026-12-02 12:30:00+01', (select id from public.locations where name = '2e étage'));
select tests.assert(
  (select scheduled_at = '2026-12-02 11:30:00+00' and schedule_by = :alice_id::uuid from public.matches where id = :m1)
  and (select l.name from public.matches m join public.locations l on l.id = m.location_id where m.id = :m1) = '2e étage',
  'joueur : lieu et horaire proposés');
select set_config('request.jwt.claim.sub', :bob_id, true);
select public.set_match_schedule(:m1, '2026-12-03 13:15:00+01', null);
select tests.assert(
  (select scheduled_at = '2026-12-03 12:15:00+00' and location_id is null and schedule_by = :bob_id::uuid from public.matches where id = :m1),
  'adversaire : modification sans validation');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-05 12:30:00+01', null)$$, :m1),
  'matches_schedule_slot', 'samedi refusé');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-02 12:20:00+01', null)$$, :m1),
  'matches_schedule_slot', 'horaire hors tranche de 15 minutes refusé');
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.set_match_schedule(%L, null, null)$$, :m1),
  'NOT_MY_MATCH', 'joueur hors du match : modification interdite');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.expect_error(format($$select public.set_match_schedule(%L, null, null)$$, :m1),
  'FORBIDDEN', 'spectateur : modification interdite');
select tests.expect_error(format($$update public.matches set location_id = null where id = %L$$, :m1),
  'permission denied', 'modification directe des matchs interdite');

-- Après le résultat : figé pour les joueurs, modifiable par l'admin
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.submit_match_result(:m1, :pa, null);
select tests.expect_error(format($$select public.set_match_schedule(%L, null, null)$$, :m1),
  'SCHEDULE_LOCKED', 'match joué : lieu et horaire figés pour les joueurs');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.set_match_schedule(:m1, null, (select id from public.locations where name = 'Cafétéria'));
select tests.assert((select scheduled_at is null and location_id is not null from public.matches where id = :m1),
  'admin : modification d''un match joué');

-- Suppression d'un lieu utilisé : le match perd son lieu
delete from public.locations where name = 'Cafétéria';
select tests.assert((select location_id is null from public.matches where id = :m1), 'lieu supprimé : retiré des matchs');

-- ---------------------------------------------------------------- Inversion domicile/extérieur
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_swap_home_away(%L)$$, :m2), 'FORBIDDEN', 'joueur : inversion interdite');
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_swap_home_away(%L)$$, :m1), 'SWAP_NOT_POSSIBLE', 'match joué : inversion impossible');
select public.admin_swap_home_away(:m2);
select tests.assert((select home_player_id = :pd::uuid and away_player_id = :pc::uuid from public.matches where id = :m2),
  'inversion domicile/extérieur');
-- Finale : Alice déjà placée à domicile ; après inversion elle passe à l'extérieur et M2 alimente le domicile.
select public.admin_swap_home_away(:m3);
select tests.assert(
  (select away_player_id = :pa::uuid and home_player_id is null from public.matches where id = :m3)
  and (select next_slot from public.matches where id = :m1) = 'away'
  and (select next_slot from public.matches where id = :m2) = 'home',
  'inversion d''un match en attente : liens des matchs précédents inversés');
select public.submit_match_result(:m2, :pc, null);
select tests.assert((select home_player_id from public.matches where id = :m3) = :pc::uuid,
  'après inversion : le vainqueur arrive du bon côté');
reset role;

rollback;
\echo '✅ Tous les tests SQL du lieu et de l''horaire sont passés'
