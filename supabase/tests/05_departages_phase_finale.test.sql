-- Tests de l'étape 4 : départages de poule, génération / annulation de la phase finale.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set carol_id '''00000000-0000-0000-0000-0000000000c0'''
\set spect_id '''00000000-0000-0000-0000-00000000005e'''
\set t1  '''10000000-0000-0000-0000-000000000001'''
\set rp  '''30000000-0000-0000-0000-000000000001'''
\set pool_a '''50000000-0000-0000-0000-00000000000a'''
\set pool_b '''50000000-0000-0000-0000-00000000000b'''
\set a1 '''20000000-0000-0000-0000-0000000000a1'''
\set a2 '''20000000-0000-0000-0000-0000000000a2'''
\set a3 '''20000000-0000-0000-0000-0000000000a3'''
\set b1 '''20000000-0000-0000-0000-0000000000b1'''
\set b2 '''20000000-0000-0000-0000-0000000000b2'''
\set b3 '''20000000-0000-0000-0000-0000000000b3'''
\set cx '''20000000-0000-0000-0000-0000000000cc'''

-- ---------------------------------------------------------------- Mise en place (superutilisateur)
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:carol_id, 'carol@fft.fr', '{"full_name":"Carol Petit"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;

insert into public.players (id, profile_id, full_name) values (:a1, :alice_id, '--'), (:cx, :carol_id, '--');
insert into public.players (id, full_name) values
  (:a2, 'A deux'), (:a3, 'A trois'), (:b1, 'B un'), (:b2, 'B deux'), (:b3, 'B trois');

-- Fléchettes, 2 poules de 3, 1 qualifié par poule.
insert into public.tournaments (id, name, discipline, format, status, pool_count, qualifiers_per_pool)
values (:t1, 'Fléchettes à poules', 'darts', 'pools_knockout', 'in_progress', 2, 1);
insert into public.pools (id, tournament_id, label) values (:pool_a, :t1, 'A'), (:pool_b, :t1, 'B');
insert into public.tournament_entries (tournament_id, player_id, pool_id) values
  (:t1, :a1, :pool_a), (:t1, :a2, :pool_a), (:t1, :a3, :pool_a),
  (:t1, :b1, :pool_b), (:t1, :b2, :pool_b), (:t1, :b3, :pool_b);
insert into public.tournament_rounds (id, tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
values (:rp, :t1, 'pool', 1, 'Poules', 1, 301, 'pool-1');
insert into public.matches (tournament_id, round_id, pool_id, position, plan_key, home_player_id, away_player_id) values
  (:t1, :rp, :pool_a, 1, 'pool-A-1', :a1, :a2),
  (:t1, :rp, :pool_a, 2, 'pool-A-2', :a2, :a3),
  (:t1, :rp, :pool_a, 3, 'pool-A-3', :a3, :a1),
  (:t1, :rp, :pool_b, 4, 'pool-B-1', :b1, :b2),
  (:t1, :rp, :pool_b, 5, 'pool-B-2', :b2, :b3),
  (:t1, :rp, :pool_b, 6, 'pool-B-3', :b3, :b1);

create temp table final_plan as select format($json${
  "pools": [],
  "rounds": [{"key": "main-1", "bracket": "main", "roundNumber": 1, "name": "Finale"}],
  "matches": [{"key": "main-1-1", "roundKey": "main-1", "poolLabel": null, "position": 1, "home": %1$s, "away": %2$s,
               "status": "pending", "winner": null, "next": null, "loserNext": null}]
}$json$, to_jsonb(:a1::text), to_jsonb(:b1::text))::jsonb as j;
grant select on final_plan to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Poules non terminées
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_generate_final_phase(%L, %L)$$, :t1, (select j from final_plan)),
  'POOL_NOT_FINISHED', 'phase finale impossible avant la fin des poules');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L, %L]::uuid[])$$, :pool_a, :a1, :a2, :a3),
  'POOL_NOT_FINISHED', 'départage impossible avant la fin de la poule');

-- Poule A : cycle a1 > a2 > a3 > a1 (égalité à trois) ; poule B : b1 gagne tout.
reset role;
update public.matches set status = 'played', winner_player_id = home_player_id where tournament_id = :t1 and plan_key <> 'pool-B-3';
update public.matches set status = 'played', winner_player_id = away_player_id where plan_key = 'pool-B-3';
set local role authenticated;

-- ---------------------------------------------------------------- Départage (partie de fléchettes à plusieurs)
select set_config('request.jwt.claim.sub', :carol_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L, %L]::uuid[])$$, :pool_a, :a1, :a2, :a3),
  'NOT_MY_MATCH', 'joueur non concerné : départage interdit');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L, %L]::uuid[])$$, :pool_a, :a1, :a2, :a3),
  'FORBIDDEN', 'spectateur : départage interdit');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L]::uuid[])$$, :pool_a, :a1, :b1),
  'INVALID_TIEBREAK', 'départage avec un joueur d''une autre poule refusé');
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L]::uuid[])$$, :pool_a, :a1, :a1),
  'INVALID_TIEBREAK', 'départage avec un joueur en double refusé');

select public.submit_pool_tiebreak(:pool_a, array[:a3, :a1, :a2]::uuid[]);
select tests.assert(
  (select ranking = array[:a3, :a1, :a2]::uuid[] and result_by = :alice_id::uuid and not result_by_admin
   from public.pool_tiebreaks where pool_id = :pool_a),
  'départage saisi par un joueur concerné, auteur tracé');
select public.submit_pool_tiebreak(:pool_a, array[:a1, :a3, :a2]::uuid[]);
select tests.assert(
  (select count(*) from public.pool_tiebreaks where pool_id = :pool_a) = 1
  and (select ranking[1] from public.pool_tiebreaks where pool_id = :pool_a) = :a1::uuid,
  'correction du départage par son auteur (même groupe : une seule ligne)');

select set_config('request.jwt.claim.sub', :admin_id, true);
select public.submit_pool_tiebreak(:pool_a, array[:a2, :a1, :a3]::uuid[]);
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L, %L]::uuid[])$$, :pool_a, :a1, :a2, :a3),
  'RESULT_LOCKED', 'départage saisi par l''admin : non modifiable par le joueur');

select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.pool_tiebreaks) = 1, 'spectateur : départages visibles');

-- ---------------------------------------------------------------- Génération de la phase finale
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_generate_final_phase(%L, %L)$$, :t1, (select j from final_plan)),
  'FORBIDDEN', 'joueur : génération interdite');

select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(
  format($$select public.admin_generate_final_phase(%L, %L)$$, :t1,
    (select jsonb_set(j, '{matches,0,away}', to_jsonb(:cx::text)) from final_plan)),
  'INVALID_PLAN', 'plan avec un joueur non inscrit refusé');
select tests.expect_error(
  format($$select public.admin_generate_final_phase(%L, %L)$$, :t1,
    (select jsonb_set(j, '{matches,0,away}', 'null') from final_plan)),
  'INVALID_PLAN', 'plan sans le bon nombre de qualifiés refusé');

select public.admin_generate_final_phase(:t1, (select j from final_plan));
select tests.assert(
  (select count(*) from public.tournament_rounds where tournament_id = :t1 and bracket = 'main') = 1
  and (select home_player_id = :a1::uuid and away_player_id = :b1::uuid from public.matches where plan_key = 'main-1-1'),
  'phase finale générée');
select tests.expect_error(format($$select public.admin_generate_final_phase(%L, %L)$$, :t1, (select j from final_plan)),
  'FINAL_PHASE_EXISTS', 'phase finale déjà générée');

-- Poules figées
select tests.expect_error(
  format($$select public.submit_match_result((select id from public.matches where plan_key = 'pool-A-1'), %L, null)$$, :a2),
  'FINAL_PHASE_EXISTS', 'résultat de poule figé après la phase finale (même pour l''admin)');
select tests.expect_error(format($$select public.submit_pool_tiebreak(%L, array[%L, %L, %L]::uuid[])$$, :pool_a, :a1, :a2, :a3),
  'FINAL_PHASE_EXISTS', 'départage figé après la phase finale');

-- ---------------------------------------------------------------- Annulation de la phase finale
select public.submit_match_result((select id from public.matches where plan_key = 'main-1-1'), :a1, null);
select tests.expect_error(format($$select public.admin_reset_final_phase(%L)$$, :t1),
  'TOURNAMENT_HAS_RESULTS', 'annulation impossible si un match de la phase finale est joué');
select public.clear_match_result((select id from public.matches where plan_key = 'main-1-1'));
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error(format($$select public.admin_reset_final_phase(%L)$$, :t1), 'FORBIDDEN', 'joueur : annulation interdite');
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_reset_final_phase(:t1);
select tests.assert(
  not exists (select 1 from public.tournament_rounds where tournament_id = :t1 and bracket <> 'pool')
  and (select count(*) from public.matches where tournament_id = :t1) = 6,
  'phase finale annulée, poules conservées');
select public.submit_match_result((select id from public.matches where plan_key = 'pool-A-1'), :a2, null);
select tests.assert((select winner_player_id from public.matches where plan_key = 'pool-A-1') = :a2::uuid,
  'après annulation : résultats de poule à nouveau modifiables');
reset role;

rollback;
\echo '✅ Tous les tests SQL des départages et de la phase finale sont passés'
