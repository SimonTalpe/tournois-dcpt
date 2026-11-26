-- Noms de comptes uniques (sans tenir compte des majuscules, accents et espaces).

\set ON_ERROR_STOP on
begin;

\set admin_id '''00000000-0000-0000-0000-00000000000a'''
\set alice_id '''00000000-0000-0000-0000-0000000000a1'''
\set bob_id   '''00000000-0000-0000-0000-0000000000b0'''

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  (:admin_id, 'sim@fft.fr', '{"full_name":"Sim Admin"}', now()),
  (:alice_id, 'alice@fft.fr', '{"full_name":"Alice Martin"}', now()),
  (:bob_id, 'bob@fft.fr', '{"full_name":"Bob Durand"}', now());
update public.profiles set role = 'admin' where id = :admin_id;
insert into public.players (full_name) values ('Chloé Petit');

set local role authenticated;
select set_config('request.jwt.claim.sub', :alice_id, true);
select tests.expect_error($$update public.profiles set full_name = 'Bob Durand' where id = auth.uid()$$,
  'NAME_TAKEN', 'joueur : nom d''un autre compte refusé');
select tests.expect_error($$update public.profiles set full_name = '  bob   DURAND ' where id = auth.uid()$$,
  'NAME_TAKEN', 'majuscules et espaces ignorés');
select tests.expect_error($$update public.profiles set full_name = 'Sim Admín' where id = auth.uid()$$,
  'NAME_TAKEN', 'accents ignorés');
update public.profiles set full_name = 'Chloé Petit' where id = auth.uid();
select tests.assert((select full_name = 'Chloé Petit' from public.profiles where id = :alice_id),
  'nom d''un « nom seul » accepté');
update public.profiles set full_name = 'Alice M.' where id = auth.uid();
select tests.assert((select full_name = 'Alice M.' from public.profiles where id = :alice_id), 'nom libre accepté');
update public.profiles set full_name = 'alice m.' where id = auth.uid();
select tests.assert(true, 'son propre nom (autre casse) accepté');

select set_config('request.jwt.claim.sub', :admin_id, true);
select tests.expect_error(format($$select public.admin_rename_account(%L, 'Bob Durand')$$, :alice_id),
  'NAME_TAKEN', 'admin : renommage vers un nom pris refusé aussi');

-- Inscription avec un nom déjà pris : suffixe.
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'bob2@fft.fr', '{"full_name":"Bob Durand"}', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'bob3@fft.fr', '{"full_name":"bob durand"}', now());
select tests.assert((select full_name = 'Bob Durand 2' from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'inscription : « Bob Durand 2 »');
select tests.assert((select full_name = 'bob durand 3' from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'inscription : « bob durand 3 »');

-- Compte supprimé : son nom est libéré, et plusieurs « Joueur supprimé » coexistent.
update public.profiles set status = 'deleted', full_name = public.deleted_player_name() where id = :bob_id;
update public.profiles set status = 'deleted', full_name = public.deleted_player_name()
  where id = '00000000-0000-0000-0000-0000000000b1';
select tests.assert((select count(*) = 2 from public.profiles where status = 'deleted'), 'plusieurs comptes supprimés');
update public.profiles set full_name = 'Bob Durand' where id = '00000000-0000-0000-0000-0000000000b2';
select tests.assert(true, 'nom d''un compte supprimé réutilisable');

rollback;
