-- Tests de l'étape 5 : annonces, notifications in-app, description riche.

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''
\set spect_id '''00000000-0000-0000-0000-00000000005e'''
\set a1 '''50000000-0000-0000-0000-000000000001'''
\set a2 '''50000000-0000-0000-0000-000000000002'''
\set a3 '''50000000-0000-0000-0000-000000000003'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now());
insert into auth.users (id, is_anonymous) values (:spect_id, true);
update public.profiles set role = 'admin' where id = :admin_id;
update public.profiles set status = 'disabled' where id = :bob_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_spectator_code('pause2026');
select set_config('request.jwt.claim.sub', :spect_id, true);
select public.redeem_spectator_code('pause2026');

-- ---------------------------------------------------------------- Création (admin seul)
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error($$insert into public.announcements (title) values ('Pirate')$$, 'row-level security',
  'joueur : création d''annonce interdite');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.expect_error($$insert into public.announcements (title) values ('Pirate')$$, 'row-level security',
  'spectateur : création d''annonce interdite');

select set_config('request.jwt.claim.sub', :admin_id, true);
insert into public.announcements (id, title, body, notify) values
  (:a1, 'Lancement des tournois', '<p>C''est parti !</p>', true);
insert into public.announcements (id, title, published_at) values
  (:a2, 'Programmée', now() + interval '2 days');
insert into public.announcements (id, title, published_at, expires_at, notify) values
  (:a3, 'Expirée', now() - interval '3 days', now() - interval '1 day', true);
select tests.assert((select created_by = :admin_id::uuid from public.announcements where id = :a1), 'auteur enregistré');
select tests.expect_error($$insert into public.announcements (title, published_at, expires_at)
  values ('Incohérente', now(), now() - interval '1 hour')$$, 'announcements_expiry_check', 'expiration avant publication refusée');
select tests.expect_error($$insert into public.announcements (title) values ('x')$$, 'announcements_title_check',
  'titre trop court refusé');
select tests.expect_error(format($$insert into public.announcements (title, created_by) values ('Usurpée', %L)$$, :alice_id),
  'permission denied', 'auteur non modifiable');
select tests.assert((select count(*) from public.announcements) = 3, 'admin : voit les annonces programmées et expirées');

-- ---------------------------------------------------------------- Lecture
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select array_agg(title) from public.announcements) = array['Lancement des tournois'],
  'spectateur : seulement les annonces en ligne');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.announcements) = 1, 'joueur : seulement les annonces en ligne');
update public.announcements set title = 'Modifiée' where id = :a1;
delete from public.announcements where id = :a1;
select tests.assert((select title from public.announcements where id = :a1) = 'Lancement des tournois',
  'joueur : modification et suppression sans effet (refusées par les règles)');

-- ---------------------------------------------------------------- Notifications
select tests.assert((select count(*) from public.notifications) = 1, 'joueur : sa notification (annonce en ligne seulement)');
select tests.assert((select announcement_id = :a1::uuid and read_at is null from public.notifications), 'notification non lue');
select tests.expect_error($$update public.notifications set read_at = now()$$, 'permission denied',
  'notification non modifiable directement');
select public.mark_notifications_read();
select tests.assert((select read_at is not null from public.notifications), 'notifications marquées comme lues');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert((select count(*) from public.notifications) = 0, 'spectateur : aucune notification');
reset role;
select tests.assert(not exists (select 1 from public.notifications where recipient_id = :bob_id), 'compte désactivé : pas notifié');
select tests.assert((select count(*) from public.notifications where announcement_id = :a1) = 2,
  'une notification par compte actif (admin compris)');
set local role authenticated;

-- Programmée avec « notifier » : visible à la publication seulement.
select set_config('request.jwt.claim.sub', :admin_id, true);
update public.announcements set notify = true where id = :a2;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.notifications where read_at is null) = 0,
  'annonce programmée : notification pas encore visible');
select set_config('request.jwt.claim.sub', :admin_id, true);
update public.announcements set published_at = now() - interval '1 minute' where id = :a2;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert((select count(*) from public.notifications where read_at is null) = 1,
  'annonce publiée : notification visible');
select public.mark_notifications_read(:a2);
select set_config('request.jwt.claim.sub', :admin_id, true);
update public.announcements set notify = false where id = :a1;
reset role;
select tests.assert((select array_agg(recipient_id) from public.notifications where announcement_id = :a1) = array[:alice_id::uuid],
  'notifier décoché : notification déjà lue (Alice) conservée, non lue (admin) retirée');
select tests.assert(not exists (select 1 from public.notifications where announcement_id = :a1 and read_at is null),
  'notifier décoché : notifications non lues retirées');
set local role authenticated;

-- Suppression
select set_config('request.jwt.claim.sub', :admin_id, true);
delete from public.announcements where id = :a2;
reset role;
select tests.assert(not exists (select 1 from public.notifications where announcement_id = :a2),
  'annonce supprimée : ses notifications aussi');

-- ---------------------------------------------------------------- Description riche
insert into public.tournaments (name, discipline, description) values ('Mini-pong', 'mini_pong', repeat('a', 15000));
select tests.assert(true, 'description riche jusqu''à 20 000 caractères');
select tests.expect_error($$insert into public.tournaments (name, discipline, description) values ('Trop long', 'darts', repeat('a', 20001))$$,
  'tournaments_description_check', 'description trop longue refusée');

-- Temps réel
select tests.assert(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename in ('announcements', 'notifications')) = 2,
  'annonces et notifications publiées pour le temps réel');

rollback;
\echo '✅ Tous les tests SQL des annonces sont passés'
