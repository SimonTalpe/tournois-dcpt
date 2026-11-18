-- Tests de l'étape 3 : tournois, inscriptions, tirage, droits.

\set ON_ERROR_STOP on
begin;

\set admin_id  '''00000000-0000-0000-0000-00000000000a'''
\set alice_id  '''00000000-0000-0000-0000-0000000000a1'''
\set spect_id  '''00000000-0000-0000-0000-00000000005e'''
\set t_id      '''10000000-0000-0000-0000-000000000001'''
\set p1        '''20000000-0000-0000-0000-000000000001'''
\set p2        '''20000000-0000-0000-0000-000000000002'''
\set p3        '''20000000-0000-0000-0000-000000000003'''
\set p4        '''20000000-0000-0000-0000-000000000004'''
\set p5        '''20000000-0000-0000-0000-000000000005'''

-- ---------------------------------------------------------------- Mise en place
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Participants
select set_config('request.jwt.claim.sub', :admin_id, true);
insert into public.players (id, profile_id, full_name) values (:p1, :alice_id, 'Nom ignoré');
insert into public.players (id, full_name) values (:p2, 'Bruno Nom-Seul'), (:p3, 'Chloé Nom-Seul'),
  (:p4, 'David Nom-Seul'), (:p5, 'Emma Nom-Seul');
select tests.assert((select full_name from public.players where id = :p1) = 'Alice Martin',
  'participant lié à un compte : nom recopié du profil');
reset role;
update public.profiles set full_name = 'Alice M.' where id = :alice_id;
select tests.assert((select full_name from public.players where id = :p1) = 'Alice M.',
  'renommage du compte répercuté sur le participant');

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error($$insert into public.players (full_name) values ('Pirate')$$, 'row-level security',
  'joueur : création de participant interdite');
select tests.assert((select count(*) from public.players) = 5, 'joueur : voit les participants');

select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.players) = 5, 'spectateur : voit les noms des participants');

-- ---------------------------------------------------------------- Création (brouillon)
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(
  $$insert into public.tournaments (name, discipline) values ('Pirate', 'darts')$$,
  'row-level security', 'joueur : création de tournoi interdite');

select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(
  $$insert into public.tournaments (name, discipline, format) values ('Poules sans options', 'darts', 'pools_knockout')$$,
  'tournaments_pool_options', 'format avec poules : nombre de poules et qualifiés obligatoires');
insert into public.tournaments (id, name, discipline, third_place, consolation)
values (:t_id, 'Mini-pong de décembre', 'mini_pong', true, true);
insert into public.tournament_entries (tournament_id, player_id)
values (:t_id, :p1), (:t_id, :p2), (:t_id, :p3), (:t_id, :p4), (:t_id, :p5);
select tests.assert((select status from public.tournaments where id = :t_id) = 'draft', 'nouveau tournoi en brouillon');
select tests.expect_error(
  format($$update public.tournaments set status = 'finished' where id = %L$$, :t_id),
  'permission denied', 'statut non modifiable directement');

select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.tournaments) = 0, 'joueur : brouillon invisible');
select tests.assert((select count(*) from public.tournament_entries) = 0, 'joueur : inscriptions du brouillon invisibles');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.tournaments) = 0, 'spectateur : brouillon invisible');

-- ---------------------------------------------------------------- Lancement
-- Plan à 5 joueurs : tableau de 8 (3 exempts), 1er tour = 4 matchs dont 1 réel ; consolante trop petite.
select set_config('request.jwt.claim.sub', :admin_id, true);

create temp table plan as select format($json${
  "pools": [],
  "rounds": [
    {"key": "main-1", "bracket": "main", "roundNumber": 1, "name": "Quarts de finale"},
    {"key": "main-2", "bracket": "main", "roundNumber": 2, "name": "Demi-finales"},
    {"key": "main-3", "bracket": "main", "roundNumber": 3, "name": "Finale"},
    {"key": "third_place-1", "bracket": "third_place", "roundNumber": 1, "name": "Match pour la 3e place"}
  ],
  "matches": [
    {"key": "main-1-1", "roundKey": "main-1", "poolLabel": null, "position": 1, "home": %1$s, "away": null,
     "status": "bye", "winner": %1$s, "next": {"matchKey": "main-2-1", "slot": "home"}, "loserNext": null},
    {"key": "main-1-2", "roundKey": "main-1", "poolLabel": null, "position": 2, "home": %4$s, "away": %5$s,
     "status": "pending", "winner": null, "next": {"matchKey": "main-2-1", "slot": "away"}, "loserNext": null},
    {"key": "main-1-3", "roundKey": "main-1", "poolLabel": null, "position": 3, "home": %2$s, "away": null,
     "status": "bye", "winner": %2$s, "next": {"matchKey": "main-2-2", "slot": "home"}, "loserNext": null},
    {"key": "main-1-4", "roundKey": "main-1", "poolLabel": null, "position": 4, "home": %3$s, "away": null,
     "status": "bye", "winner": %3$s, "next": {"matchKey": "main-2-2", "slot": "away"}, "loserNext": null},
    {"key": "main-2-1", "roundKey": "main-2", "poolLabel": null, "position": 1, "home": %1$s, "away": null,
     "status": "pending", "winner": null, "next": {"matchKey": "main-3-1", "slot": "home"},
     "loserNext": {"matchKey": "third_place-1-1", "slot": "home"}},
    {"key": "main-2-2", "roundKey": "main-2", "poolLabel": null, "position": 2, "home": %2$s, "away": %3$s,
     "status": "pending", "winner": null, "next": {"matchKey": "main-3-1", "slot": "away"},
     "loserNext": {"matchKey": "third_place-1-1", "slot": "away"}},
    {"key": "main-3-1", "roundKey": "main-3", "poolLabel": null, "position": 1, "home": null, "away": null,
     "status": "pending", "winner": null, "next": null, "loserNext": null},
    {"key": "third_place-1-1", "roundKey": "third_place-1", "poolLabel": null, "position": 1, "home": null,
     "away": null, "status": "pending", "winner": null, "next": null, "loserNext": null}
  ]
}$json$, to_jsonb(:p1::text), to_jsonb(:p2::text), to_jsonb(:p3::text), to_jsonb(:p4::text), to_jsonb(:p5::text))::jsonb as j;
grant select on plan to authenticated;

-- Plan incomplet (un inscrit oublié) refusé
select tests.expect_error(
  format($$select public.admin_launch_tournament(%L, %L)$$, :t_id,
    (select jsonb_set(j, '{matches,1,away}', 'null') from plan)),
  'INVALID_PLAN', 'plan sans tous les inscrits refusé');

select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(
  format($$select public.admin_launch_tournament(%L, %L)$$, :t_id, (select j from plan)),
  'FORBIDDEN', 'joueur : lancement interdit');

select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_launch_tournament(:t_id, (select j from plan));
select tests.assert((select status from public.tournaments where id = :t_id) = 'in_progress', 'tournoi lancé');
select tests.assert((select count(*) from public.matches where tournament_id = :t_id) = 8, '8 matchs créés');
select tests.assert((select count(*) from public.matches where tournament_id = :t_id and status = 'bye') = 3, '3 exempts');
select tests.assert(
  (select n.plan_key from public.matches m join public.matches n on n.id = m.next_match_id where m.plan_key = 'main-1-2') = 'main-2-1'
  and (select next_slot from public.matches where plan_key = 'main-1-2') = 'away',
  'lien vainqueur → match suivant');
select tests.assert(
  (select n.plan_key from public.matches m join public.matches n on n.id = m.loser_next_match_id where m.plan_key = 'main-2-2') = 'third_place-1-1',
  'lien perdant de demi-finale → 3e place');
select tests.assert(
  (select sets_to_win from public.tournament_rounds where plan_key = 'main-3') = 2,
  'format de jeu par défaut recopié dans les tours');

-- Format de jeu par tour
update public.tournament_rounds set sets_to_win = 3 where plan_key = 'main-3';
select tests.assert((select sets_to_win from public.tournament_rounds where plan_key = 'main-3') = 3, 'admin : format de la finale modifié');

-- Structure figée, inscriptions verrouillées
select tests.expect_error(
  format($$update public.tournaments set third_place = false where id = %L$$, :t_id),
  'CONFIG_LOCKED', 'options du tableau figées après lancement');
update public.tournaments set description = 'Pauses de midi' where id = :t_id;
select tests.expect_error(
  format($$insert into public.tournament_entries (tournament_id, player_id) values (%L, gen_random_uuid())$$, :t_id),
  'row-level security', 'inscriptions verrouillées après lancement');

-- Visibilité
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.tournaments) = 1, 'joueur : tournoi lancé visible');
select tests.assert((select count(*) from public.matches) = 8, 'joueur : matchs visibles');
-- Droit de colonne accordé à tous, mais la règle RLS limite à l'admin : la mise à jour ne touche aucune ligne.
update public.tournament_rounds set sets_to_win = 1;
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.matches) = 8, 'spectateur : matchs visibles');
select tests.assert((select sets_to_win from public.tournament_rounds where plan_key = 'main-3') = 3,
  'joueur : modification du format sans effet (RLS)');

-- ---------------------------------------------------------------- Remplacement
select set_config('request.jwt.claim.sub', :admin_id, true);
insert into public.players (id, full_name) values ('20000000-0000-0000-0000-000000000006', 'Fanny Remplaçante');
select tests.expect_error(
  format($$select public.admin_replace_player(%L, %L, %L)$$, :t_id, :p2, :p3),
  'ALREADY_ENTERED', 'remplacement par un joueur déjà inscrit refusé');
select public.admin_replace_player(:t_id, :p2, '20000000-0000-0000-0000-000000000006');
select tests.assert(
  (select count(*) from public.matches where '20000000-0000-0000-0000-000000000006' in (home_player_id, away_player_id, winner_player_id)) = 2,
  'remplaçant placé dans l''exempt et le match suivant');
select tests.assert(
  not exists (select 1 from public.tournament_entries where player_id = :p2),
  'ancien joueur désinscrit');

-- Un match joué empêche de refaire le tirage
reset role;
update public.matches set status = 'played', winner_player_id = :p4 where plan_key = 'main-1-2';
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(
  format($$select public.admin_reset_tournament(%L)$$, :t_id), 'TOURNAMENT_HAS_RESULTS',
  'retour en brouillon impossible après un match joué');
select tests.expect_error(
  format($$select public.admin_launch_tournament(%L, %L)$$, :t_id, (select j from plan)),
  'TOURNAMENT_HAS_RESULTS', 'nouveau tirage impossible après un match joué');
reset role;
update public.matches set status = 'pending', winner_player_id = null where plan_key = 'main-1-2';
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);

-- Annulation du lancement
select public.admin_reset_tournament(:t_id);
select tests.assert((select status from public.tournaments where id = :t_id) = 'draft', 'retour en brouillon');
select tests.assert((select count(*) from public.matches where tournament_id = :t_id) = 0, 'tirage supprimé');
select tests.assert((select count(*) from public.tournament_entries where tournament_id = :t_id) = 5, 'inscriptions conservées');

-- ---------------------------------------------------------------- Cycle de vie
select tests.expect_error(
  format($$select public.admin_set_tournament_status(%L, 'finished')$$, :t_id),
  'INVALID_STATUS', 'brouillon : clôture impossible');

-- Tournoi à poules : 4 joueurs, 2 poules
insert into public.tournaments (id, name, discipline, format, pool_count, qualifiers_per_pool)
values ('10000000-0000-0000-0000-000000000002', 'Fléchettes', 'darts', 'pools_knockout', 2, 1);
insert into public.tournament_entries (tournament_id, player_id) values
  ('10000000-0000-0000-0000-000000000002', :p1), ('10000000-0000-0000-0000-000000000002', :p3),
  ('10000000-0000-0000-0000-000000000002', :p4), ('10000000-0000-0000-0000-000000000002', :p5);
select public.admin_launch_tournament('10000000-0000-0000-0000-000000000002', format($json${
  "pools": [{"label": "A", "playerIds": [%1$s, %2$s]}, {"label": "B", "playerIds": [%3$s, %4$s]}],
  "rounds": [{"key": "pool-1", "bracket": "pool", "roundNumber": 1, "name": "Poules"}],
  "matches": [
    {"key": "pool-A-1", "roundKey": "pool-1", "poolLabel": "A", "position": 1, "home": %1$s, "away": %2$s,
     "status": "pending", "winner": null, "next": null, "loserNext": null},
    {"key": "pool-B-1", "roundKey": "pool-1", "poolLabel": "B", "position": 2, "home": %4$s, "away": %3$s,
     "status": "pending", "winner": null, "next": null, "loserNext": null}
  ]
}$json$, to_jsonb(:p1::text), to_jsonb(:p3::text), to_jsonb(:p4::text), to_jsonb(:p5::text))::jsonb);
select tests.assert(
  (select count(*) from public.tournament_entries e join public.pools p on p.id = e.pool_id
   where e.tournament_id = '10000000-0000-0000-0000-000000000002' and p.label = 'A') = 2,
  'poules : joueurs répartis');
select tests.assert(
  (select dart_start from public.tournament_rounds where tournament_id = '10000000-0000-0000-0000-000000000002') = 301,
  'fléchettes : 301 par défaut');

select public.admin_set_tournament_status('10000000-0000-0000-0000-000000000002', 'finished');
select public.admin_set_tournament_status('10000000-0000-0000-0000-000000000002', 'archived');
select tests.expect_error(
  $$select public.admin_set_tournament_status('10000000-0000-0000-0000-000000000002', 'in_progress')$$,
  'INVALID_STATUS', 'archivé : retour direct en cours impossible');
select tests.expect_error(
  $$select public.admin_replace_player('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006')$$,
  'TOURNAMENT_CLOSED', 'tournoi archivé : remplacement impossible');

-- Suppression d'un participant inscrit impossible ; suppression du tournoi en cascade
select tests.expect_error(format($$delete from public.players where id = %L$$, :p1), 'foreign key',
  'participant inscrit : suppression impossible');
delete from public.tournaments where id = '10000000-0000-0000-0000-000000000002';
select tests.assert(
  not exists (select 1 from public.matches where tournament_id = '10000000-0000-0000-0000-000000000002'),
  'suppression du tournoi : matchs supprimés');
reset role;

rollback;
\echo '✅ Tous les tests SQL de l''étape 3 sont passés'
