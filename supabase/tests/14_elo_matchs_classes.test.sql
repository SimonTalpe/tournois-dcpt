-- Tests de l'Elo et des matchs classés : calcul, matchs de tournoi pris en compte, saisie,
-- limites, corrections, suppression, compteur, notifications, droits.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set dave_id  '''00000000-0000-0000-0000-0000000000d0'''
\set eve_id   '''00000000-0000-0000-0000-0000000000e0'''
\set spect_id '''00000000-0000-0000-0000-00000000005e'''
\set t1  '''10000000-0000-0000-0000-000000000001'''
\set r1  '''30000000-0000-0000-0000-000000000001'''
\set pa  '''20000000-0000-0000-0000-0000000000a1'''
\set pb  '''20000000-0000-0000-0000-0000000000b0'''
\set pd  '''20000000-0000-0000-0000-0000000000d0'''
\set m1  '''40000000-0000-0000-0000-000000000001'''
\set m2  '''40000000-0000-0000-0000-000000000002'''
\set m3  '''40000000-0000-0000-0000-000000000003'''
\set k1  '''70000000-0000-0000-0000-000000000001'''
\set k2  '''70000000-0000-0000-0000-000000000002'''
\set k3  '''70000000-0000-0000-0000-000000000003'''
\set k4  '''70000000-0000-0000-0000-000000000004'''
\set k5  '''70000000-0000-0000-0000-000000000005'''
\set k6  '''70000000-0000-0000-0000-000000000006'''
\set g1  '''71000000-0000-0000-0000-000000000001'''
\set g2  '''71000000-0000-0000-0000-000000000002'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now()),
  (:dave_id, 'dave@fft.fr', '{"full_name":"Dave Non Confirmé"}', null),
  (:eve_id, 'eve@fft.fr', '{"full_name":"Eve Désactivée"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;
update public.profiles set status = 'disabled' where id = :eve_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--');
insert into public.players (id, full_name) values (:pd, 'David Nom-Seul');
-- Code spectateur
update public.app_settings set spectator_code_hash = 'x', spectator_code_version = 1;
insert into public.spectator_access (user_id, code_version) values (:spect_id, 1);

-- Tournoi de mini-pong : Alice bat David (nom seul) il y a un jour ; forfait et match annulé ignorés.
insert into public.tournaments (id, name, discipline, status, default_sets_to_win)
values (:t1, 'Mini-pong', 'mini_pong', 'in_progress', 1);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:r1, :t1, 'main', 1, 'Tour 1', 1, 301, 'main-1');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb), (:t1, :pd);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id, status,
                            winner_player_id, result_first_at, forfeit_player_id) values
  (:m1, :t1, :r1, 1, 'm1', :pa, :pd, 'played', :pa, now() - interval '1 day', null),
  (:m2, :t1, :r1, 2, 'm2', :pa, :pb, 'walkover', :pa, now() - interval '1 day', :pb),
  (:m3, :t1, :r1, 3, 'm3', :pb, :pd, 'cancelled', null, null, null);

-- ---------------------------------------------------------------- Paramètres
select tests.assert(public.elo_k(0) = 40 and public.elo_k(9) = 40 and public.elo_k(10) = 20 and public.elo_k(50) = 20,
  'K = 40 pendant les 10 premiers matchs, puis 20');

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);

-- ---------------------------------------------------------------- Match de tournoi contre un nom seul
select tests.assert(
  (select rating_after = 1220 and delta = 20 and source = 'tournament' and seq = 1
   from public.get_elo_history('mini_pong', :pa::uuid)),
  'match de tournoi contre un nom seul : Alice 1200 → 1220 (le nom seul compte pour 1200)');
select tests.assert(
  (select count(*) from public.get_elo_history('mini_pong')) = 1,
  'forfait et match annulé ignorés ; le nom seul n''a pas d''Elo');

-- ---------------------------------------------------------------- Matchs classés
select tests.assert(
  public.record_ranked_match(:k1, 'mini_pong', :alice_id, :bob_id, '{"home":11,"away":8}')
    = jsonb_build_object('id', :k1::uuid, 'home_delta', 19, 'away_delta', -19),
  'match classé : Alice (1220) bat Bob (1200) : +19 / −19');
select tests.assert(
  public.record_ranked_match(:k1, 'mini_pong', :alice_id, :bob_id, '{"home":11,"away":8}') ->> 'home_delta' = '19',
  'nouvel essai (coupure réseau) : pas de doublon');
select tests.assert((select count(*) from public.ranked_matches) = 1, 'un seul match enregistré');
select tests.assert(
  (select winner_player_id = :pa::uuid and home_points = 11 and away_points = 8 and created_by = :alice_id::uuid
          and not created_by_admin from public.ranked_matches where id = :k1),
  'match classé enregistré (vainqueur déduit du score, auteur)');
select tests.assert(not exists (select 1 from public.notifications), 'l''auteur n''est pas notifié');

select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.assert(
  (select kind = 'ranked_match' and ranked_match_id = :k1::uuid and actor_id = :alice_id::uuid
          and elo_delta = -19 and not recipient_won and read_at is null
   from public.notifications),
  'Bob (adversaire) notifié : défaite, −19 Elo');
select tests.assert(
  public.record_ranked_match(:k2, 'mini_pong', :bob_id, :alice_id, '{"home":13,"away":11}')
    = jsonb_build_object('id', :k2::uuid, 'home_delta', 23, 'away_delta', -23),
  'revanche : Bob (1181) bat Alice (1239) : +23 / −23');
select tests.assert(
  (select array_agg(rating_after order by seq) from public.get_elo_history('mini_pong', :pa::uuid)) = array[1220, 1239, 1216],
  'courbe d''Alice : 1220, 1239, 1216');
select tests.assert(
  (select array_agg(rating_after order by seq) from public.get_elo_history('mini_pong', :pb::uuid)) = array[1181, 1204],
  'courbe de Bob : 1181, 1204');

-- Limite : 3 matchs classés par jour contre le même adversaire (dans les deux sens), par discipline.
select public.record_ranked_match(:k3, 'mini_pong', :bob_id, :alice_id, '{"home":11,"away":3}');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k4, :bob_id, :alice_id), 'RANKED_DAILY_LIMIT', '4e match classé du jour contre le même adversaire : refusé');
select tests.assert(
  public.record_ranked_match(:k4, 'darts', :bob_id, :alice_id, '{"winner":"away","loser_remaining":null}') ->> 'id' = :k4,
  'autre discipline : pas concernée par la limite (fléchettes, reste du perdant facultatif)');

-- ---------------------------------------------------------------- Refus
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":10}')$$,
  :k5, :bob_id, :carol_id), 'INVALID_SCORE', 'set 11-10 : refusé (2 points d''écart)');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":21,"away":11}')$$,
  :k5, :bob_id, :carol_id), 'INVALID_SCORE', 'set 21-11 : refusé (au-delà de 11, 2 points d''écart exactement)');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'darts', %L, %L, '{"winner":"nobody"}')$$,
  :k5, :bob_id, :carol_id), 'INVALID_RANKED_SCORE', 'fléchettes : vainqueur invalide');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'darts', %L, %L, '{"winner":"home","loser_remaining":0}')$$,
  :k5, :bob_id, :carol_id), 'INVALID_RANKED_SCORE', 'fléchettes : reste du perdant à 0 refusé');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'darts', %L, %L, '{"winner":"home","loser_remaining":302}')$$,
  :k5, :bob_id, :carol_id), 'INVALID_RANKED_SCORE', 'fléchettes : reste du perdant > 301 refusé');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k5, :bob_id, :bob_id), 'RANKED_SELF', 'match contre soi-même : refusé');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k5, :bob_id, :dave_id), 'RANKED_PLAYER_INACTIVE', 'adversaire à l''email non confirmé : refusé');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k5, :bob_id, :eve_id), 'RANKED_PLAYER_INACTIVE', 'adversaire désactivé : refusé');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k5, :alice_id, :carol_id), 'NOT_MY_MATCH', 'joueur : uniquement ses propres matchs');
select tests.expect_error(format($$select public.record_ranked_match(%L, 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :k1, :bob_id, :carol_id), 'FORBIDDEN', 'identifiant d''un match saisi par un autre : refusé');
select tests.expect_error($$insert into public.ranked_matches (id, discipline, home_player_id, away_player_id, winner_player_id, created_by)
  values (gen_random_uuid(), 'darts', '20000000-0000-0000-0000-0000000000b0', '20000000-0000-0000-0000-0000000000a1',
          '20000000-0000-0000-0000-0000000000b0', auth.uid())$$, 'permission denied', 'écriture directe : refusée');
select tests.expect_error($$select * from public.elo_history$$, 'permission denied', 'historique Elo : pas de lecture directe');

-- ---------------------------------------------------------------- Corrections
select tests.expect_error(format($$select public.correct_ranked_match(%L, '{"home":3,"away":11}')$$, :k1),
  'RANKED_LOCKED', 'l''adversaire ne corrige pas un match saisi par l''autre');
select tests.expect_error(format($$select public.delete_ranked_match(%L)$$, :k1),
  'RANKED_LOCKED', 'l''adversaire ne supprime pas un match saisi par l''autre');
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.mark_notifications_read();
select public.correct_ranked_match(:k1, '{"home":8,"away":11}');
select tests.assert((select winner_player_id = :pb::uuid from public.ranked_matches where id = :k1),
  'l''auteur corrige dans les 24 h : Bob vainqueur');
select tests.assert(
  (select array_agg(won order by seq) from public.get_elo_history('mini_pong', :pa::uuid)) = array[true, false, false, false],
  'Elo recalculé après la correction (Alice : V, D, D, D)');
select tests.assert(
  (select bool_and(rating_after = rating_before + delta) from public.get_elo_history('mini_pong')),
  'cohérence : Elo après = Elo avant + écart');
select tests.assert(
  (select bool_and(h.rating_before = coalesce(prev.rating_after, 1200))
   from public.get_elo_history('mini_pong') h
   left join public.get_elo_history('mini_pong') prev on prev.player_id = h.player_id and prev.seq = h.seq - 1),
  'chaque match part de l''Elo laissé par le précédent (1200 au départ)');
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.assert(
  (select read_at is null and recipient_won and elo_delta > 0 from public.notifications where ranked_match_id = :k1),
  'correction : Bob notifié à nouveau (victoire, non lue)');

-- Délai de 24 h dépassé : auteur bloqué, admin autorisé.
reset role;
update public.ranked_matches set played_at = played_at - interval '25 hours' where id = :k3;
set local role authenticated;
select tests.expect_error(format($$select public.correct_ranked_match(%L, '{"home":3,"away":11}')$$, :k3),
  'RANKED_LOCKED', 'après 24 h : l''auteur ne corrige plus');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.correct_ranked_match(:k3, '{"home":3,"away":11}');
select tests.assert((select winner_player_id = :pa::uuid from public.ranked_matches where id = :k3), 'l''admin corrige après 24 h');
select public.delete_ranked_match(:k3);
select tests.assert(not exists (select 1 from public.ranked_matches where id = :k3), 'l''admin supprime un match classé');
select tests.assert(not exists (select 1 from public.notifications where ranked_match_id = :k3), 'notifications du match supprimées');

-- Admin : saisie pour deux joueurs (marquée « saisie admin ») sans limite quotidienne.
select public.record_ranked_match(:k5, 'mini_pong', :bob_id, :alice_id, '{"home":11,"away":5}');
select public.record_ranked_match(:k6, 'mini_pong', :bob_id, :alice_id, '{"home":11,"away":5}');
select tests.assert((select bool_and(created_by_admin) from public.ranked_matches where id in (:k5, :k6)),
  'admin : saisie pour deux autres joueurs (4e match du jour accepté)');
reset role;
select tests.assert((select count(*) from public.notifications where ranked_match_id = :k5) = 2,
  'saisie de l''admin : les deux joueurs notifiés');
set local role authenticated;
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.delete_ranked_match(%L)$$, :k5),
  'RANKED_LOCKED', 'saisie de l''admin : non modifiable par les joueurs');
select public.delete_ranked_match(:k4);
select tests.assert(not exists (select 1 from public.ranked_matches where id = :k4), 'l''auteur supprime son match dans les 24 h');

-- ---------------------------------------------------------------- Compteur (match classé de fléchettes)
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.assert(
  public.record_ranked_dart_game(:g1, now() - interval '5 minutes',
    format('[{"profile_id":%s,"rank":2,"remaining":47,"darts":21,"points":254},
             {"profile_id":%s,"rank":1,"remaining":0,"darts":21,"points":301}]',
           to_json(:alice_id::text), to_json(:carol_id::text))::jsonb) ->> 'home_delta' = '20',
  'compteur : Carol bat Alice (+20 pour Carol, joueur à domicile = celui qui tient le compteur)');
select tests.assert(
  (select r.discipline = 'darts' and r.loser_remaining = 47 and r.dart_game_id = :g1::uuid
          and r.winner_player_id = (select id from public.players where profile_id = :carol_id)
          and g.start_score = 301 and not g.double_out
   from public.ranked_matches r join public.dart_games g on g.id = r.dart_game_id where r.id = :g1),
  'compteur : match classé lié à la partie (301, sortie simple, reste du perdant)');
select public.record_ranked_dart_game(:g1, now(), '[]'::jsonb);
select tests.assert((select count(*) from public.dart_games where id = :g1) = 1, 'compteur : nouvel essai sans doublon');
select tests.expect_error(format($$select public.record_ranked_dart_game(%L, now(),
  '[{"profile_id":%s,"rank":1,"remaining":0,"darts":3,"points":301},{"profile_id":%s,"rank":2,"remaining":0,"darts":3,"points":301}]')$$,
  :g2, to_json(:carol_id::text), to_json(:bob_id::text)), 'INVALID_RANKED_GAME', 'compteur : deux vainqueurs refusés');
select tests.expect_error(format($$select public.record_ranked_dart_game(%L, now(),
  '[{"profile_id":%s,"rank":1,"remaining":0,"darts":3,"points":301},{"player_id":%s,"rank":2,"remaining":30,"darts":3,"points":271}]')$$,
  :g2, to_json(:carol_id::text), to_json(:pd::text)), 'INVALID_RANKED_GAME', 'compteur : un nom seul ne joue pas de match classé');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.correct_ranked_match(%L, '{"winner":"home"}')$$, :g1),
  'RANKED_LOCKED', 'compteur : seul celui qui a tenu le compteur corrige');
select set_config('request.jwt.claim.sub', :carol_id, true);
select public.correct_ranked_match(:g1, '{"winner":"away","loser_remaining":12}');
select tests.assert((select dart_game_id is null from public.ranked_matches where id = :g1),
  'correction à la main : la partie du compteur est détachée');
select tests.assert(exists (select 1 from public.dart_games where id = :g1), 'la partie reste dans l''historique du compteur');

-- ---------------------------------------------------------------- Lecture
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.assert(exists (select 1 from public.players where profile_id = :carol_id),
  'joueur : fiche d''un compte ayant joué un match classé visible (lien vers le profil)');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(distinct player_id) from public.get_elo_history('darts')) = 2,
  'spectateur : lecture du leaderboard');
select tests.assert(not exists (select 1 from public.ranked_matches), 'spectateur : matchs classés non lisibles');
select tests.assert(not exists (select 1 from public.notifications), 'spectateur : pas de notifications');
select tests.expect_error(format($$select public.record_ranked_match(gen_random_uuid(), 'mini_pong', %L, %L, '{"home":11,"away":3}')$$,
  :bob_id, :alice_id), 'FORBIDDEN', 'spectateur : pas de saisie');
select set_config('request.jwt.claim.sub', :dave_id, true);
select tests.expect_error($$select * from public.get_elo_history('darts')$$, 'FORBIDDEN', 'email non confirmé : pas de lecture');

-- ---------------------------------------------------------------- Notifications : lecture par type ou une à une
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.notifications where read_at is null) >= 2, 'Alice a des notifications non lues');
select public.mark_notifications_read(p_kind => 'announcement');
select tests.assert((select count(*) from public.notifications where read_at is null) >= 2,
  'page Annonces : les notifications de matchs classés restent non lues');
select public.mark_notifications_read(p_notification_id => (select id from public.notifications where ranked_match_id = :k5));
select tests.assert((select read_at is not null from public.notifications where ranked_match_id = :k5),
  'notification marquée comme lue une à une');

-- ---------------------------------------------------------------- Recalcul après une modification de tournoi
select count(*) from public.get_elo_history('mini_pong');
reset role;
select tests.assert((select not dirty from public.elo_state where discipline = 'mini_pong'), 'mini-pong à jour après lecture');
update public.matches set winner_player_id = :pd where id = :m1;
select tests.assert((select dirty from public.elo_state where discipline = 'mini_pong'), 'résultat de tournoi modifié : à recalculer');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert(
  (select rating_after = 1180 and not won from public.get_elo_history('mini_pong', :pa::uuid) where seq = 1),
  'recalcul : Alice perd désormais contre David (1180)');

-- Rattachement du nom seul à un compte : ses matchs de tournoi deviennent des matchs Elo.
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_link_player_to_account(:pd, :dave_id);
select tests.assert(
  (select rating_after = 1220 and won from public.get_elo_history('mini_pong', :pd::uuid) where seq = 1),
  'rattachement : le match de David compte pour son compte (1200 → 1220)');

rollback;
\echo '✅ Tous les tests SQL de l''Elo et des matchs classés sont passés'
