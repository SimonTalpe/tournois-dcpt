-- Tests de l'étape 2 : comptes, rôles, accès.
-- Lancés par les vérifications GitHub sur un PostgreSQL vierge après les migrations.
-- Chaque « set local role / request.jwt.claim.sub » simule une session Supabase.

\set ON_ERROR_STOP on
begin;

-- Identifiants fixes pour la lisibilité
\set admin_id   '''00000000-0000-0000-0000-00000000000a'''
\set alice_id   '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id     '''00000000-0000-0000-0000-0000000000b0'''
\set spect_id   '''00000000-0000-0000-0000-00000000005e'''
\set spect2_id  '''00000000-0000-0000-0000-00000000005f'''

-- ---------------------------------------------------------------- Inscription
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now());
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values (:alice_id, 'Alice.Martin@FFT.fr', '{"full_name":"  Alice Martin "}', now());
insert into auth.users (id, email, raw_user_meta_data)
values (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}'); -- email non confirmé
insert into auth.users (id, is_anonymous) values (:spect_id, true), (:spect2_id, true);

select tests.assert((select count(*) from public.profiles) = 3, 'un profil par compte email, aucun pour les anonymes');
select tests.assert((select full_name from public.profiles where id = :alice_id) = 'Alice Martin', 'nom complet nettoyé des espaces');
select tests.assert((select role from public.profiles where id = :alice_id) = 'player', 'rôle joueur par défaut');

select tests.expect_error(
  $$insert into auth.users (email, raw_user_meta_data) values ('pirate@gmail.com', '{"full_name":"Pirate"}')$$,
  'EMAIL_NOT_ALLOWED', 'inscription refusée hors domaine autorisé');

insert into public.allowed_emails (email) values ('testeur@gmail.com');
insert into auth.users (email, raw_user_meta_data) values ('Testeur@Gmail.com', '{"full_name":"Testeur"}');
select tests.assert(exists (select 1 from public.profiles where full_name = 'Testeur'), 'adresse individuelle autorisée acceptée (casse ignorée)');

select tests.expect_error(
  format($$update auth.users set email = 'alice@yahoo.fr' where id = %L$$, :alice_id),
  'EMAIL_NOT_ALLOWED', 'changement d''email vers une adresse non autorisée refusé');

update public.profiles set role = 'admin' where id = :admin_id;

-- ---------------------------------------------------------------- Vérification d'adresse avant inscription
set local role anon;
select tests.assert(public.is_email_allowed('nouveau@fft.fr'), 'anon : adresse @fft.fr acceptée');
select tests.assert(not public.is_email_allowed('nouveau@gmail.com'), 'anon : adresse gmail refusée');
select tests.assert(not public.is_email_allowed('fft.fr'), 'anon : texte sans @ refusé');
select tests.expect_error('select public.my_access()', 'permission denied', 'anon : pas d''accès aux autres fonctions');
select tests.expect_error('select * from public.profiles', 'permission denied', 'anon : profils illisibles');
reset role;

-- ---------------------------------------------------------------- Joueur
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);

select tests.assert(public.my_access() = 'player', 'Alice confirmée = joueur');
select tests.assert((select count(*) from public.profiles) = 4, 'joueur : voit tous les profils');
select tests.expect_error('select * from public.admin_list_accounts()', 'FORBIDDEN', 'joueur : liste des comptes interdite');
select tests.expect_error($$select public.admin_set_spectator_code('9999')$$, 'FORBIDDEN', 'joueur : changement du code spectateur interdit');
select tests.expect_error(
  format($$select public.admin_set_account_status(%L, 'disabled')$$, :bob_id),
  'FORBIDDEN', 'joueur : désactivation interdite');
select tests.expect_error($$update public.profiles set role = 'admin'$$, 'permission denied', 'joueur : impossible de se donner le rôle admin');
select tests.expect_error($$update public.profiles set status = 'active'$$, 'permission denied', 'joueur : impossible de changer son statut');
select tests.expect_error($$insert into public.allowed_emails (email) values ('ami@gmail.com')$$, 'row-level security', 'joueur : ajout d''adresse autorisée interdit');
select tests.assert((select count(*) from public.allowed_email_domains) = 0, 'joueur : domaines autorisés invisibles');

update public.profiles set full_name = 'Alice M.' where id = :alice_id;
update public.profiles set full_name = 'Piraté' where id = :bob_id;
reset role;
select tests.assert((select full_name from public.profiles where id = :alice_id) = 'Alice M.', 'joueur : peut modifier son propre nom');
select tests.assert((select full_name from public.profiles where id = :bob_id) = 'Bob Durand', 'joueur : ne peut pas modifier le nom d''un autre');

-- ---------------------------------------------------------------- Email non confirmé
set local role authenticated;
select set_config('request.jwt.claim.sub', :bob_id, true);
select tests.assert(public.my_access() = 'none', 'email non confirmé = aucun accès');
select tests.assert((select count(*) from public.profiles) = 1, 'email non confirmé : ne voit que son profil');
reset role;

-- ---------------------------------------------------------------- Spectateur
set local role authenticated;
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert(public.my_access() = 'none', 'anonyme sans code = aucun accès');
select tests.assert(not public.redeem_spectator_code('1234'), 'aucun code défini : refus');

select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.assert(public.my_access() = 'admin', 'Sim = admin');
select public.admin_set_spectator_code('  pause2026 ');
select tests.assert((select is_set from public.admin_spectator_code_status()), 'admin : code spectateur défini');

select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert(not public.redeem_spectator_code('mauvais'), 'mauvais code refusé');
select tests.assert(public.redeem_spectator_code('pause2026'), 'bon code accepté');
select tests.assert(public.my_access() = 'spectator', 'session spectateur ouverte');
select tests.assert(public.can_view_site(), 'spectateur : peut voir le site');
select tests.assert((select count(*) from public.profiles) = 0, 'spectateur : aucun profil visible');
select tests.expect_error('select * from public.app_settings', 'permission denied', 'spectateur : réglages illisibles');

-- Limitation des essais
select set_config('request.jwt.claim.sub', :spect2_id, true);
select public.redeem_spectator_code('x1'), public.redeem_spectator_code('x2'), public.redeem_spectator_code('x3'),
       public.redeem_spectator_code('x4'), public.redeem_spectator_code('x5');
select tests.expect_error($$select public.redeem_spectator_code('pause2026')$$, 'TOO_MANY_ATTEMPTS', '5 échecs : essais bloqués');

-- Changement de code = révocation
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error($$select public.admin_set_spectator_code('abc')$$, 'INVALID_CODE', 'code trop court refusé');
select public.admin_set_spectator_code('nouveau-code');
select set_config('request.jwt.claim.sub', :spect_id, true);
select tests.assert(public.my_access() = 'none', 'changement de code : accès spectateur révoqué');
reset role;

-- ---------------------------------------------------------------- Administration des comptes
set local role authenticated;
select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.assert((select count(*) from public.admin_list_accounts()) = 4, 'admin : liste des comptes');
select tests.assert(
  (select email from public.admin_list_accounts() where id = :alice_id::uuid) = 'Alice.Martin@FFT.fr',
  'admin : voit les emails');
select tests.expect_error(
  format($$select public.admin_set_account_status(%L, 'disabled')$$, :admin_id),
  'CANNOT_CHANGE_OWN_STATUS', 'admin : ne peut pas se désactiver lui-même');
select public.admin_set_account_status(:alice_id, 'disabled');
select public.admin_rename_account(:bob_id, 'Robert Durand');
insert into public.allowed_email_domains (domain) values ('fff.fr');
select tests.assert((select count(*) from public.allowed_email_domains) = 2, 'admin : gère les domaines autorisés');

select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert(public.my_access() = 'disabled', 'compte désactivé détecté');
select tests.assert(not public.can_view_site(), 'compte désactivé : plus d''accès au site');
select tests.assert((select count(*) from public.profiles) = 1, 'compte désactivé : ne voit que son profil');

select set_config('request.jwt.claim.sub', :admin_id, true);
select public.admin_set_account_status(:alice_id, 'active');
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.assert(public.my_access() = 'player', 'compte réactivé');
reset role;

select tests.assert((select full_name from public.profiles where id = :bob_id) = 'Robert Durand', 'admin : renommage');

rollback;
\echo '✅ Tous les tests SQL de l''étape 2 sont passés'
