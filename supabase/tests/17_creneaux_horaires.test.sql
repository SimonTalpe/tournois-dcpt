-- Créneaux horaires des matchs : 12:00–13:30 et 17:30–19:00 (heure de Paris, bornes incluses).

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


-- 2 décembre 2026 = mercredi (heure d'hiver) ; 3 juin 2027 = jeudi (heure d'été).
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.set_match_schedule(:m1, '2026-12-02 12:00:00 Europe/Paris', null);
select public.set_match_schedule(:m1, '2026-12-02 13:30:00 Europe/Paris', null);
select public.set_match_schedule(:m1, '2026-12-02 17:30:00 Europe/Paris', null);
select public.set_match_schedule(:m1, '2027-06-03 19:00:00 Europe/Paris', null);
select tests.assert(true, 'bornes des deux plages acceptées, hiver comme été');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-02 11:45:00 Europe/Paris', null)$$, :m1),
  'SCHEDULE_OUTSIDE_HOURS', '11:45 refusé');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-02 13:45:00 Europe/Paris', null)$$, :m1),
  'SCHEDULE_OUTSIDE_HOURS', '13:45 refusé');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-02 17:15:00 Europe/Paris', null)$$, :m1),
  'SCHEDULE_OUTSIDE_HOURS', '17:15 refusé');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2027-06-03 19:15:00 Europe/Paris', null)$$, :m1),
  'SCHEDULE_OUTSIDE_HOURS', '19:15 refusé (heure d''été)');
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-02 08:00:00 Europe/Paris', null)$$, :m1),
  'SCHEDULE_OUTSIDE_HOURS', 'admin : 08:00 refusé aussi');

-- Horaire fixé avant la mise en place des plages : conservé (changement de lieu seul), effaçable.
reset role;
update public.matches set scheduled_at = '2026-12-02 08:00:00 Europe/Paris' where id = :m2;
set local role authenticated;
select public.set_match_schedule(:m2, '2026-12-02 08:00:00 Europe/Paris', (select id from public.locations where name = '2e étage'));
select tests.assert((select location_id is not null from public.matches where id = :m2), 'ancien horaire conservé, lieu modifié');
select tests.expect_error(format($$select public.set_match_schedule(%L, '2026-12-03 08:00:00 Europe/Paris', null)$$, :m2),
  'SCHEDULE_OUTSIDE_HOURS', 'ancien horaire : déplacement hors plages refusé');
select public.set_match_schedule(:m2, null, null);
select tests.assert((select scheduled_at is null from public.matches where id = :m2), 'ancien horaire effaçable');

rollback;
