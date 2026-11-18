-- Tests de l'étape 4 : rattachement d'un « nom seul » à un compte.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set t1       '''10000000-0000-0000-0000-000000000001'''
\set t2       '''10000000-0000-0000-0000-000000000002'''
\set r1       '''30000000-0000-0000-0000-000000000001'''
\set r2       '''30000000-0000-0000-0000-000000000002'''
\set bob_p    '''20000000-0000-0000-0000-0000000000b0'''
\set n_alice  '''20000000-0000-0000-0000-000000000001'''
\set n_bob    '''20000000-0000-0000-0000-000000000002'''
\set n_bob2   '''20000000-0000-0000-0000-000000000003'''
\set other    '''20000000-0000-0000-0000-000000000004'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now());
update public.profiles set role = 'admin' where id = :admin_id;

insert into public.players (id, profile_id, full_name) values (:bob_p, :bob_id, '--');
insert into public.players (id, full_name) values
  (:n_alice, 'Alice (nom seul)'), (:n_bob, 'Bob (nom seul)'), (:n_bob2, 'Bob bis'), (:other, 'Zoé Nom-Seul');

insert into public.tournaments (id, name, discipline, status) values
  (:t1, 'Mini-pong de décembre', 'mini_pong', 'in_progress'),
  (:t2, 'Fléchettes de décembre', 'darts', 'in_progress');
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key) values
  (:r1, :t1, 'main', 1, 'Finale', 2, 301, 'main-1'),
  (:r2, :t2, 'main', 1, 'Finale', 2, 301, 'main-1');
-- T1 : nom seul d'Alice contre Zoé (match joué, Alice gagnante) ; nom seul de Bob inscrit
-- T2 : Bob (compte) contre nom seul « Bob bis »
insert into public.tournament_entries (tournament_id, player_id) values
  (:t1, :n_alice), (:t1, :other), (:t1, :n_bob), (:t2, :bob_p), (:t2, :n_bob2);
insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id, winner_player_id, status) values
  (:t1, :r1, 1, 'main-1-1', :n_alice, :other, :n_alice, 'played'),
  (:t1, :r1, 2, 'main-1-2', :other, :n_alice, null, 'pending'),
  (:t2, :r2, 1, 'main-1-1', :bob_p, :n_bob2, null, 'pending');

-- ---------------------------------------------------------------- Droits
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_link_player_to_account(%L, %L)$$, :n_alice, :alice_id),
  'FORBIDDEN', 'joueur : rattachement interdit');
select tests.expect_error($$select * from public.admin_list_name_only_players()$$,
  'FORBIDDEN', 'joueur : liste des noms seuls interdite');

select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.assert((select count(*) from public.admin_list_name_only_players()) = 4, 'admin : 4 noms seuls listés');
select tests.assert(
  (select tournaments from public.admin_list_name_only_players() where id = :n_alice) = '{"Mini-pong de décembre"}'
  and (select match_count from public.admin_list_name_only_players() where id = :n_alice) = 2,
  'admin : tournois et nombre de matchs du nom seul');

-- ---------------------------------------------------------------- Compte sans fiche : le nom seul devient sa fiche
select tests.assert(public.admin_link_player_to_account(:n_alice, :alice_id) = :n_alice::uuid,
  'rattachement simple : fiche conservée');
select tests.assert(
  (select profile_id = :alice_id::uuid and full_name = 'Alice Martin' from public.players where id = :n_alice),
  'rattachement simple : fiche liée au compte, nom du compte');
select tests.assert(
  (select count(*) from public.matches where :n_alice::uuid in (home_player_id, away_player_id)) = 2,
  'rattachement simple : matchs joués et à venir conservés');
select tests.expect_error(format($$select public.admin_link_player_to_account(%L, %L)$$, :n_alice, :bob_id),
  'NOT_NAME_ONLY', 'fiche déjà liée à un compte : rattachement refusé');

-- ---------------------------------------------------------------- Compte avec fiche : fusion
select tests.assert(public.admin_link_player_to_account(:n_bob, :bob_id) = :bob_p::uuid,
  'fusion : fiche du compte conservée');
select tests.assert(not exists (select 1 from public.players where id = :n_bob), 'fusion : nom seul supprimé');
select tests.assert(
  exists (select 1 from public.tournament_entries where tournament_id = :t1 and player_id = :bob_p),
  'fusion : inscription transférée au compte');

-- Fusion refusée si les deux fiches jouent dans un même tournoi
select tests.expect_error(format($$select public.admin_link_player_to_account(%L, %L)$$, :n_bob2, :bob_id),
  'MERGE_CONFLICT', 'fusion : refusée si les deux fiches jouent le même tournoi');
select tests.assert(exists (select 1 from public.players where id = :n_bob2), 'fusion refusée : nom seul intact');

-- Fusion avec transfert d'un match joué (vainqueur compris)
reset role;
delete from public.matches where tournament_id = :t2;
delete from public.tournament_entries where tournament_id = :t2 and player_id = :bob_p;
insert into public.matches (tournament_id, round_id, position, plan_key, home_player_id, away_player_id, winner_player_id, status)
values (:t2, :r2, 1, 'main-1-1', :other, :n_bob2, :n_bob2, 'played');
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_link_player_to_account(:n_bob2, :bob_id);
select tests.assert(
  (select away_player_id = :bob_p::uuid and winner_player_id = :bob_p::uuid from public.matches where tournament_id = :t2),
  'fusion : match joué transféré, vainqueur compris');

-- Compte inexistant
select tests.expect_error(
  format($$select public.admin_link_player_to_account(%L, '00000000-0000-0000-0000-0000000000ff')$$, :other),
  'NOT_FOUND', 'compte inconnu : rattachement refusé');
reset role;

rollback;
\echo '✅ Tous les tests SQL du rattachement nom seul → compte sont passés'
