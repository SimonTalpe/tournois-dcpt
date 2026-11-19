-- Tests de l'étape 5 : suppression de compte (anonymisation).

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set t1 '''10000000-0000-0000-0000-000000000001'''
\set r1 '''30000000-0000-0000-0000-000000000001'''
\set pa '''20000000-0000-0000-0000-0000000000a1'''
\set pb '''20000000-0000-0000-0000-0000000000b0'''
\set pc '''20000000-0000-0000-0000-0000000000c0'''
\set m1 '''40000000-0000-0000-0000-000000000001'''
\set m2 '''40000000-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (id, profile_id, full_name) values (:pa, :alice_id, '--'), (:pb, :bob_id, '--'), (:pc, :carol_id, '--');
insert into public.tournaments (id, name, discipline, status) values (:t1, 'Fléchettes', 'darts', 'in_progress');
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'pool', 1, 'Poules', 1, 301, 'pool-1');
insert into public.tournament_entries (tournament_id, player_id) values (:t1, :pa), (:t1, :pb), (:t1, :pc);
insert into public.matches (id, tournament_id, round_id, position, plan_key, home_player_id, away_player_id) values
  (:m1, :t1, :r1, 1, 'p-1', :pa, :pb), (:m2, :t1, :r1, 2, 'p-2', :pa, :pc);
insert into public.announcements (title, notify) values ('Bienvenue', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select public.submit_match_result(:m1, :pa, null);

-- ---------------------------------------------------------------- Suppression par le joueur
select tests.expect_error(format($$select public.admin_delete_account(%L)$$, :bob_id), 'FORBIDDEN',
  'joueur : suppression du compte d''un autre interdite');
select public.delete_my_account();
reset role;
select tests.assert(
  (select full_name = 'Joueur supprimé' and status = 'deleted' and role = 'player' from public.profiles where id = :alice_id),
  'profil anonymisé et marqué supprimé');
select tests.assert((select full_name from public.players where id = :pa) = 'Joueur supprimé',
  'tableaux : « Joueur supprimé »');
select tests.assert(
  (select winner_player_id = :pa::uuid and result_by = :alice_id::uuid and status = 'played' from public.matches where id = :m1),
  'résultats conservés');
select tests.assert(not exists (select 1 from public.notifications where recipient_id = :alice_id),
  'notifications effacées');
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert(public.my_access() = 'disabled', 'compte supprimé : plus aucun accès joueur');
select tests.assert((select count(*) from public.matches) = 0, 'compte supprimé : plus de lecture des tournois');
select tests.expect_error($$select public.delete_my_account()$$, 'NOT_FOUND', 'suppression déjà faite');

-- Le nom reste figé même si le joueur tente de le changer
update public.profiles set full_name = 'Alice revient' where id = :alice_id;
reset role;
select tests.assert((select full_name from public.profiles where id = :alice_id) = 'Joueur supprimé',
  'compte supprimé : nom non modifiable');

-- L'adresse fictive posée par la suppression d'authentification est acceptée
update auth.users set email = 'deleted-xyz@supprime.invalid' where id = :alice_id;
select tests.assert(true, 'email fictif accepté pour un compte supprimé');
select tests.expect_error(format($$update auth.users set email = 'bob@gmail.com' where id = %L$$, :bob_id),
  'EMAIL_NOT_ALLOWED', 'compte actif : adresse non autorisée toujours refusée');

-- ---------------------------------------------------------------- Admin
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_delete_account(%L)$$, :admin_id), 'CANNOT_DELETE_OWN_ACCOUNT',
  'admin : passe par « Supprimer mon compte » pour lui-même');
select tests.expect_error($$select public.delete_my_account()$$, 'LAST_ADMIN', 'dernier admin : suppression refusée');
select public.admin_delete_account(:carol_id);
select tests.assert(
  (select array_agg(player_id order by player_id) from public.admin_disabled_players_with_pending_matches()
   where tournament_id = :t1::uuid and full_name = 'Joueur supprimé' and pending_matches = 1) = array[:pa::uuid, :pc::uuid],
  'compte supprimé avec un match à jouer : signalé à l''admin (remplacer ou forfait)');
select tests.assert(
  not exists (select 1 from public.admin_list_accounts() where id in (:alice_id, :carol_id)),
  'comptes supprimés retirés de la liste des comptes');
select tests.expect_error(format($$select public.admin_delete_account(%L)$$, :carol_id), 'NOT_FOUND',
  'compte déjà supprimé');
reset role;

rollback;
\echo '✅ Tous les tests SQL de la suppression de compte sont passés'
