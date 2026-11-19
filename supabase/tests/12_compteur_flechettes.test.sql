-- Tests du compteur de fléchettes : liste des personnes, enregistrement d'une partie, droits.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set dave_id  '''00000000-0000-0000-0000-0000000000d0'''
\set spec_id  '''00000000-0000-0000-0000-0000000000e0'''
\set pj '''20000000-0000-0000-0000-0000000000f1'''
\set g1 '''50000000-0000-0000-0000-000000000001'''
\set g2 '''50000000-0000-0000-0000-000000000002'''
\set g3 '''50000000-0000-0000-0000-000000000003'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:dave_id, 'dave@fft.fr', '{"full_name":"Dave Non Confirmé"}', null);
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, full_name) values (:pj, 'Julien M.');

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);

-- ---------------------------------------------------------------- Liste des personnes
select tests.assert(
  (select array_agg(full_name order by full_name) from public.dart_list_people())
    = array['Alice Martin', 'Bob Durand', 'Julien M.', 'Sim Admin'],
  'joueur : comptes actifs confirmés + noms seuls proposés (pas de compte non confirmé)');

-- ---------------------------------------------------------------- Enregistrement
select public.record_dart_game(:g1, 301::smallint, false, 'stopped', now() - interval '10 minutes',
  format('[{"profile_id":%s,"rank":1,"remaining":0,"darts":15,"points":301},
           {"player_id":%s,"rank":2,"remaining":40,"darts":15,"points":261},
           {"new_name":"  Paul invité ","rank":3,"remaining":120,"darts":15,"points":181}]',
         to_json(:bob_id::text), to_json(:pj::text))::jsonb);
select tests.assert((select status = 'stopped' and created_by = :alice_id::uuid and player_count = 3
  from public.dart_games where id = :g1), 'partie enregistrée par le joueur qui tient le compteur');
select tests.assert((select count(*) from public.dart_game_players where game_id = :g1) = 3, '3 participants enregistrés');
reset role;
select tests.assert(exists (select 1 from public.players where profile_id = :bob_id), 'fiche joueur créée pour le compte de Bob');
select tests.assert((select count(*) from public.players where full_name = 'Paul invité' and profile_id is null) = 1,
  'nouveau joueur créé comme « nom seul » (nom nettoyé)');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);

-- Nouvel essai (coupure réseau) : pas de doublon
select tests.assert(public.record_dart_game(:g1, 301::smallint, false, 'stopped', now(), '[]'::jsonb) = :g1::uuid,
  'nouvel essai : la partie déjà enregistrée est renvoyée');

-- Même nom saisi à nouveau : le nom seul existant est réutilisé
select public.record_dart_game(:g2, 501::smallint, true, 'finished', now(),
  '[{"new_name":"paul INVITÉ","rank":1,"remaining":0,"darts":30,"points":501}]'::jsonb);
reset role;
select tests.assert((select count(*) from public.players where lower(full_name) = 'paul invité') = 1,
  'pas deux noms seuls identiques');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);

-- ---------------------------------------------------------------- Refus
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'stopped', now(),
  '[{"new_name":"Zoé","rank":1,"remaining":50,"darts":3,"points":20},{"new_name":"Léo","rank":2,"remaining":60,"darts":3,"points":20}]')$$, :g3),
  'INVALID_DART_GAME', 'partie sans aucun joueur ayant fini : refusée (annulée, rien à enregistrer)');
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(),
  '[{"player_id":%s,"rank":1,"remaining":0,"darts":3,"points":301},{"player_id":%s,"rank":2,"remaining":60,"darts":3,"points":20}]')$$,
  :g3, to_json(:pj::text), to_json(:pj::text)),
  'DUPLICATE_DART_PLAYER', 'même joueur deux fois : refusé');
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(),
  '[{"new_name":"Zoé","rank":2,"remaining":0,"darts":3,"points":301},{"new_name":"Léo","rank":1,"remaining":60,"darts":3,"points":20}]')$$, :g3),
  'INVALID_DART_GAME', 'classement incohérent : refusé');
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(),
  '[{"new_name":"Zoé","rank":1,"remaining":0,"darts":3,"points":301},{"new_name":"Léo","rank":2,"remaining":400,"darts":3,"points":0}]')$$, :g3),
  'INVALID_DART_GAME', 'score restant supérieur au départ : refusé');
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(),
  '[{"new_name":"Z","rank":1,"remaining":0,"darts":3,"points":301}]')$$, :g3),
  'players_full_name_check', 'nom trop court : refusé');
select tests.expect_error($$insert into public.dart_games (id, created_by, start_score, double_out, status, player_count, started_at)
  values (gen_random_uuid(), auth.uid(), 301, false, 'finished', 1, now())$$, 'permission denied',
  'écriture directe dans la table : interdite');
select tests.assert((select count(*) from public.dart_games) = 2, 'joueur : lecture des parties enregistrées');

-- Bob ne peut pas réécrire la partie d'Alice
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(), '[]')$$, :g1),
  'FORBIDDEN', 'identifiant d''une partie d''un autre : refusé');

-- ---------------------------------------------------------------- Spectateur / non confirmé
reset role;
insert into auth.users (id, is_anonymous) values (:spec_id, true);
update public.app_settings set spectator_code_hash = 'x';
insert into public.spectator_access (user_id, code_version)
  select :spec_id, spectator_code_version from public.app_settings;
set local role authenticated;
select set_config('request.jwt.claim.sub', :spec_id, true);
select tests.expect_error($$select * from public.dart_list_people()$$, 'FORBIDDEN', 'spectateur : pas de liste des joueurs');
select tests.expect_error(format($$select public.record_dart_game(%L, 301::smallint, false, 'finished', now(),
  '[{"new_name":"Zoé","rank":1,"remaining":0,"darts":3,"points":301}]')$$, :g3), 'FORBIDDEN',
  'spectateur : rien n''est enregistré');
select tests.assert((select count(*) from public.dart_games) = 0, 'spectateur : parties non lisibles');
select set_config('request.jwt.claim.sub', :dave_id, true);
select tests.expect_error($$select * from public.dart_list_people()$$, 'FORBIDDEN', 'email non confirmé : refusé');

-- ---------------------------------------------------------------- Rattachement nom seul → compte
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_link_player_to_account(
  (select id from public.players where full_name = 'Paul invité'), :admin_id);
reset role;
select tests.assert(
  (select count(*) from public.dart_game_players gp join public.players p on p.id = gp.player_id
   where p.profile_id = :admin_id) = 2,
  'rattachement : les parties du nom seul passent sur le compte');

-- Fusion refusée si les deux fiches ont joué la même partie
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_link_player_to_account(%L, %L)$$, :pj, :bob_id),
  'MERGE_CONFLICT_DART_GAME', 'fusion refusée : les deux fiches dans une même partie');
-- Un nom seul ayant joué au compteur ne peut pas être supprimé
select tests.expect_error(format($$delete from public.players where id = %L$$, :pj), 'foreign key',
  'nom seul utilisé dans une partie : suppression refusée');
delete from public.dart_games where id = :g1;
select tests.assert(not exists (select 1 from public.dart_game_players where game_id = :g1), 'suppression en cascade des participants');

rollback;
\echo '✅ Tous les tests SQL du compteur de fléchettes sont passés'
