-- Imitation minimale du schéma « auth » de Supabase, pour tester les migrations
-- sur un PostgreSQL ordinaire (vérifications GitHub). Ne jamais appliquer sur Supabase.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions, public to anon, authenticated;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email varchar,
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb default '{}',
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Aides de test : se faire passer pour un utilisateur, vérifier une condition, attendre une erreur.
create function tests.assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'ÉCHEC : %', p_message;
  end if;
  raise notice 'ok — %', p_message;
end $$;

create function tests.expect_error(p_sql text, p_expected text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      raise notice 'ok — %', p_message;
      return;
    end if;
    raise exception 'ÉCHEC : % (erreur inattendue : %)', p_message, sqlerrm;
  end;
  raise exception 'ÉCHEC : % (aucune erreur)', p_message;
end $$;
grant execute on function tests.assert(boolean, text), tests.expect_error(text, text, text) to anon, authenticated;
