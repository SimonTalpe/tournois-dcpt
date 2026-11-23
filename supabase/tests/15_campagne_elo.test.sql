-- Campagne de tests de l'Elo (23/11/2026) : cas limites autour des matchs de tournoi
-- (saisie, effacement, forfait, rétablissement, suppression de tournoi), des comptes
-- (désactivation, suppression, rattachement), du facteur K, de la limite quotidienne
-- et vérification indépendante de chaque ligne d'Elo par la formule.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set t1  '''10000000-0000-0000-0000-000000000001'''
\set t2  '''10000000-0000-0000-0000-000000000002'''
\set r1  '''30000000-0000-0000-0000-000000000001'''
\set r2  '''30000000-0000-0000-0000-000000000002'''
\set pa  '''20000000-0000-0000-0000-0000000000a1'''
\set pb  '''20000000-0000-0000-0000-0000000000b0'''
\set pc  '''20000000-0000-0000-0000-0000000000c0'''
\set pd  '''20000000-0000-0000-0000-0000000000d0'''
\set m1  '''40000000-0000-0000-0000-000000000001'''
\set m2  '''40000000-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--'), (:pc, :carol_id, '--');
insert into public.players (id, full_name) values (:pd, 'David Nom-Seul');

-- T1 mini-pong (1 set gagnant) : M1 Alice–Bob à jouer.
insert into public.tournaments (id, name, discipline, status, default_sets_to_win)
values (:t1, 'Mini-pong', 'mini_pong', 'in_progress', 1);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:r1, :t1, 'main', 1, 'Finale', 1, 301, 'main-1');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status)
values (:m1, :t1, :r1, 1, 'm1', :pa, :pb, 'pending');

-- T2 fléchettes : M2 Alice–David (nom seul), joué il y a 2 jours.
insert into public.tournaments (id, name, discipline, status, default_sets_to_win)
values (:t2, 'Fléchettes', 'darts', 'in_progress', 1);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:r2, :t2, 'main', 1, 'Finale', 1, 301, 'main-1');
insert into public.tournament_entries (tournament_id, player_id) values (:t2, :pa), (:t2, :pd);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status,
                            winner_player_id, home_legs, away_legs, result_first_at)
values (:m2, :t2, :r2, 1, 'm2', :pa, :pd, 'played', :pd, 0, 1, now() - interval '2 days');

-- Vérification indépendante : chaque écart = arrondi(K × (résultat − attendu)), K selon le n° du match,
-- Elo de l'adversaire = son Elo avant le match (1200 pour un nom seul) ; continuité des Elo.
create temp table checks (label text);
create function pg_temp.elo_consistent(p_discipline public.discipline) returns boolean language sql as $$
  with h as (select * from public.elo_history where discipline = p_discipline)
  select coalesce(bool_and(
           h.delta = round((public.elo_k(h.seq - 1) * ((case when h.won then 1 else 0 end)
             - 1 / (1 + power(10::float8, (coalesce(o.rating_before, 1200) - h.rating_before) / 400.0))))::numeric)
           and h.rating_before = coalesce(prev.rating_after, 1200)
           and (o.player_id is null or o.won <> h.won)), true)
  from h
  left join h o on o.match_id = h.match_id and o.player_id = h.opponent_player_id
  left join h prev on prev.player_id = h.player_id and prev.seq = h.seq - 1;
$$;
grant execute on function pg_temp.elo_consistent(public.discipline) to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------- Match de tournoi : saisie, effacement, forfait, rétablissement
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.submit_match_result(:m1, null, '[{"home":11,"away":7}]');
select tests.assert(
  (select array_agg(delta order by player_id) from public.get_elo_history('mini_pong')) = array[20, -20],
  'saisie d''un score de tournoi : Elo mis à jour (+20 / −20)');
select public.clear_match_result(:m1);
select tests.assert(not exists (select 1 from public.get_elo_history('mini_pong')), 'résultat effacé : plus d''Elo');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_walkover(:m1, :pb);
select tests.assert(not exists (select 1 from public.get_elo_history('mini_pong')), 'forfait : ne compte pas pour l''Elo');
select public.admin_reopen_match(:m1);
select public.submit_match_result(:m1, null, '[{"home":5,"away":11}]');
select tests.assert(
  (select won from public.get_elo_history('mini_pong', :pb::uuid)),
  'match rétabli puis rejoué : Bob vainqueur compte');

-- Nom seul vainqueur en fléchettes : seul le compte perd des points.
select tests.assert(
  (select count(*) = 1 and min(delta) = -20 from public.get_elo_history('darts')),
  'défaite contre un nom seul : −20 pour Alice, aucune ligne pour le nom seul');

-- ---------------------------------------------------------------- Facteur K au 11e match (saisies admin : pas de limite quotidienne)
select public.record_ranked_match(gen_random_uuid(), 'mini_pong', :alice_id, :carol_id,
  case when i % 3 = 0 then '{"home":8,"away":11}'::jsonb else '{"home":11,"away":8}'::jsonb end)
from generate_series(1, 12) i;
select tests.assert(
  (select count(*) from public.get_elo_history('mini_pong', :pa::uuid)) = 13,
  'Alice : 13 matchs Elo de mini-pong (1 tournoi + 12 classés)');
select tests.assert(
  (select abs(delta) <= 20 from public.get_elo_history('mini_pong', :pa::uuid) where seq = 11)
  and (select abs(delta) > 0 from public.get_elo_history('mini_pong', :pa::uuid) where seq = 11),
  '11e match : K = 20 (écart au plus 20)');
reset role;
select tests.assert(pg_temp.elo_consistent('mini_pong'), 'chaque ligne d''Elo vérifiée par la formule (mini-pong)');
select tests.assert(pg_temp.elo_consistent('darts'), 'chaque ligne d''Elo vérifiée par la formule (fléchettes)');
set local role authenticated;

-- ---------------------------------------------------------------- Limite quotidienne : jour calendaire de Paris
select set_config('request.jwt.claim.sub', :bob_id, true);
select public.record_ranked_match(gen_random_uuid(), 'darts', :bob_id, :carol_id, '{"winner":"home"}') from generate_series(1, 3);
reset role;
-- Ces trois matchs passent à la veille, 23 h 30 heure de Paris : ils ne comptent plus pour aujourd'hui.
update public.ranked_matches
set played_at = ((now() at time zone 'Europe/Paris')::date - 1 + time '23:30') at time zone 'Europe/Paris'
where discipline = 'darts';
set local role authenticated;
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.assert(
  public.record_ranked_match(gen_random_uuid(), 'darts', :carol_id, :bob_id, '{"winner":"away"}') ? 'id',
  'matchs de la veille (23 h 30, heure de Paris) : non comptés dans la limite du jour');

-- Une correction ne change pas la date du match (ni donc l'ordre de l'historique).
select set_config('request.jwt.claim.sub', :bob_id, true);
reset role;
create temp table before_fix as
  select id, played_at from public.ranked_matches where discipline = 'darts' and created_by = :bob_id::uuid order by played_at desc limit 1;
grant select on before_fix to authenticated;
set local role authenticated;
select public.correct_ranked_match((select id from before_fix), '{"winner":"home","loser_remaining":50}');
select tests.assert(
  (select r.played_at = b.played_at from public.ranked_matches r join before_fix b on b.id = r.id),
  'correction : date du match inchangée');

-- ---------------------------------------------------------------- Compte désactivé
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_account_status(:carol_id, 'disabled');
select tests.assert(
  (select bool_and(account_status = 'disabled') from public.get_elo_history('mini_pong', :pc::uuid)),
  'compte désactivé : historique conservé, statut transmis (exclu du leaderboard par le site)');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.record_ranked_match(gen_random_uuid(), 'mini_pong', %L, %L, '{"home":11,"away":2}')$$,
  :alice_id, :carol_id), 'RANKED_PLAYER_INACTIVE', 'pas de match classé contre un compte désactivé');
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error($$select * from public.get_elo_history('mini_pong')$$, 'FORBIDDEN', 'compte désactivé : plus de lecture');
select tests.expect_error(format($$select public.record_ranked_match(gen_random_uuid(), 'mini_pong', %L, %L, '{"home":11,"away":2}')$$,
  :carol_id, :alice_id), 'FORBIDDEN', 'compte désactivé : plus de saisie');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_account_status(:carol_id, 'active');

-- ---------------------------------------------------------------- Compte supprimé (anonymisé)
reset role;
create temp table elo_before as select player_id, seq, rating_after from public.elo_history where discipline = 'mini_pong';
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_delete_account(:carol_id);
select count(*) from public.get_elo_history('mini_pong');
reset role;
select tests.assert(
  not exists (select player_id, seq, rating_after from elo_before except select player_id, seq, rating_after from public.elo_history where discipline = 'mini_pong')
  and (select count(*) from elo_before) = (select count(*) from public.elo_history where discipline = 'mini_pong'),
  'compte supprimé : l''Elo de chacun est inchangé (résultats conservés)');
select tests.assert(not exists (select 1 from public.notifications where recipient_id = :carol_id::uuid),
  'compte supprimé : ses notifications sont effacées');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert(
  (select bool_and(full_name = 'Joueur supprimé' and account_status = 'deleted') from public.get_elo_history('mini_pong', :pc::uuid)),
  'compte supprimé : « Joueur supprimé », statut supprimé');
select tests.assert(
  (select bool_and(opponent_name = 'Joueur supprimé') from public.get_elo_history('mini_pong', :pa::uuid) where opponent_player_id = :pc::uuid),
  'historique des adversaires : « Joueur supprimé »');
select tests.expect_error(format($$select public.record_ranked_match(gen_random_uuid(), 'mini_pong', %L, %L, '{"home":11,"away":2}')$$,
  :alice_id, :carol_id), 'RANKED_PLAYER_INACTIVE', 'pas de match classé contre un compte supprimé');

-- ---------------------------------------------------------------- Rattachement d'un nom seul à un compte qui a déjà une fiche
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_link_player_to_account(:pd, :bob_id);
select tests.assert(
  (select count(*) = 1 and bool_and(source = 'tournament' and won) from public.get_elo_history('darts', :pb::uuid) where match_id = :m2::uuid),
  'fusion nom seul → Bob : le match gagné par David compte pour Bob');
select tests.assert(
  (select delta from public.get_elo_history('darts', :pa::uuid) where match_id = :m2::uuid) = -20,
  'adversaire désormais un compte (1200 au départ, 1er match) : Alice toujours −20');
reset role;
select tests.assert(pg_temp.elo_consistent('darts'), 'fléchettes : formule vérifiée après la fusion');
set local role authenticated;

-- ---------------------------------------------------------------- Suppression d'un tournoi
select set_config('request.jwt.claim.sub', :admin_id, true);
delete from public.tournaments where id = :t2;
select tests.assert(
  not exists (select 1 from public.get_elo_history('darts') where match_id = :m2::uuid),
  'tournoi supprimé : ses matchs ne comptent plus');
reset role;
select tests.assert(pg_temp.elo_consistent('darts'), 'fléchettes : formule vérifiée après suppression du tournoi');
set local role authenticated;

-- ---------------------------------------------------------------- Notifications : ancienne signature (site en cache)
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.mark_notifications_read(null::uuid);
select tests.assert(not exists (select 1 from public.notifications where read_at is null),
  'ancien appel mark_notifications_read(annonce) accepté');

-- ---------------------------------------------------------------- Lecture idempotente
select tests.assert(
  (select array_agg(rating_after order by player_id, seq) from public.get_elo_history('mini_pong'))
  = (select array_agg(rating_after order by player_id, seq) from public.get_elo_history('mini_pong')),
  'deux lectures successives : mêmes valeurs');
reset role;
create temp table snapshot as select player_id, seq, rating_after, delta from public.elo_history;
insert into public.elo_dirty (discipline) values ('mini_pong'), ('darts');
set local role authenticated;
select count(*) from public.get_elo_history('mini_pong');
select count(*) from public.get_elo_history('darts');
reset role;
select tests.assert(
  not exists ((select player_id, seq, rating_after, delta from snapshot) except (select player_id, seq, rating_after, delta from public.elo_history))
  and not exists ((select player_id, seq, rating_after, delta from public.elo_history) except (select player_id, seq, rating_after, delta from snapshot)),
  'recalcul forcé : résultat identique (calcul déterministe)');
reset role;
select tests.assert(pg_temp.elo_consistent('mini_pong'), 'mini-pong : formule vérifiée après recalcul forcé');

-- ---------------------------------------------------------------- Fusion d'un nom seul déclaré forfait (bug de la campagne)
reset role;
insert into public.players (id, full_name) values ('20000000-0000-0000-0000-0000000000e5', 'Eve Nom-Seul');
insert into public.tournaments (id, name, discipline, status, default_sets_to_win)
values ('10000000-0000-0000-0000-000000000004', 'Forfait', 'mini_pong', 'in_progress', 1);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'main', 1, 'Finale', 1, 301, 'main-1');
insert into public.tournament_entries (tournament_id, player_id)
values ('10000000-0000-0000-0000-000000000004', :pa), ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-0000000000e5');
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status,
                            winner_player_id, forfeit_player_id)
values ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004',
        1, 'm4', :pa, '20000000-0000-0000-0000-0000000000e5', 'walkover', :pa, '20000000-0000-0000-0000-0000000000e5');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_link_player_to_account('20000000-0000-0000-0000-0000000000e5', :bob_id);
select tests.assert(
  (select forfeit_player_id = :pb::uuid and away_player_id = :pb::uuid from public.matches
   where id = '40000000-0000-0000-0000-000000000004'),
  'fusion d''un nom seul déclaré forfait : le forfait passe sur le compte');
reset role;

rollback;
\echo '✅ Tous les tests SQL de la campagne Elo sont passés'
