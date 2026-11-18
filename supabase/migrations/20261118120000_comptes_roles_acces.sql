-- =====================================================================
-- Étape 2 — Comptes, rôles, accès
-- Profils joueurs, adresses autorisées, code spectateur, règles de sécurité.
-- Toutes les fonctions sensibles sont SECURITY DEFINER avec search_path vide.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.user_role as enum ('player', 'admin');
create type public.account_status as enum ('active', 'disabled', 'deleted');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Profil public d'un compte joueur (un par utilisateur auth, hors spectateurs anonymes).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  role public.user_role not null default 'player',
  status public.account_status not null default 'active',
  -- Vrai après un mot de passe provisoire généré par l'admin : le joueur doit en choisir un nouveau.
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Comptes joueurs (nom complet, rôle, statut).';

-- Domaines email autorisés à l'inscription (ex. fft.fr).
create table public.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at timestamptz not null default now()
);

-- Adresses individuelles autorisées en plus des domaines (phase de test).
create table public.allowed_emails (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

-- Réglages du site : une seule ligne. Jamais lisible directement (code haché).
create table public.app_settings (
  id boolean primary key default true check (id),
  spectator_code_hash text,
  -- Incrémenté à chaque changement de code : les accès spectateurs existants sont révoqués.
  spectator_code_version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

-- Sessions spectateur ouvertes avec le code commun (utilisateurs anonymes Supabase).
create table public.spectator_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_version integer not null,
  granted_at timestamptz not null default now()
);

-- Tentatives de code spectateur (limitation des essais).
create table public.spectator_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index spectator_code_attempts_user_idx on public.spectator_code_attempts (user_id, attempted_at desc);

insert into public.allowed_email_domains (domain) values ('fft.fr');

-- ---------------------------------------------------------------------
-- Fonctions d'aide aux droits
-- ---------------------------------------------------------------------

-- Joueur actif : profil 'active' et email confirmé.
create function public.is_active_player()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.status = 'active'
      and u.email_confirmed_at is not null
  );
$$;

-- Admin : joueur actif avec le rôle admin.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role = 'admin'
      and u.email_confirmed_at is not null
  );
$$;

-- Spectateur : session ouverte avec le code spectateur en vigueur.
create function public.is_spectator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.spectator_access sa
    join public.app_settings s on s.id
    where sa.user_id = auth.uid()
      and sa.code_version = s.spectator_code_version
      and s.spectator_code_hash is not null
  );
$$;

-- Lecture des contenus du site (tournois, tableaux, annonces…) : spectateur ou joueur actif.
create function public.can_view_site()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_player() or public.is_spectator();
$$;

-- Niveau d'accès de la session courante, pour l'interface :
-- 'admin' | 'player' | 'spectator' | 'disabled' | 'none'
create function public.my_access()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then 'admin'
    when public.is_active_player() then 'player'
    when exists (select 1 from public.profiles where id = auth.uid() and status <> 'active') then 'disabled'
    when public.is_spectator() then 'spectator'
    else 'none'
  end;
$$;

-- Adresse autorisée à l'inscription ? (domaine autorisé ou adresse individuelle)
-- Appelable avant inscription pour afficher un message clair.
create function public.is_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_email is not null
    and position('@' in p_email) > 1
    and (
      exists (select 1 from public.allowed_emails where email = lower(btrim(p_email)))
      or exists (
        select 1 from public.allowed_email_domains
        where domain = lower(split_part(btrim(p_email), '@', 2))
      )
    );
$$;

-- ---------------------------------------------------------------------
-- Inscription : contrôle de l'adresse et création du profil
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  -- Spectateurs : utilisateurs anonymes, pas de profil.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  if not public.is_email_allowed(new.email) then
    raise exception 'EMAIL_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  v_full_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  if v_full_name is null then
    v_full_name := split_part(new.email, '@', 1);
  end if;

  insert into public.profiles (id, full_name) values (new.id, left(v_full_name, 80));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Changement d'adresse email : même contrôle (sauf anonymes).
create function public.check_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email
     and new.email is not null
     and not coalesce(new.is_anonymous, false)
     and not public.is_email_allowed(new.email) then
    raise exception 'EMAIL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_change
  before update of email on auth.users
  for each row execute function public.check_user_email_change();

-- Horodatage des modifications de profil.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Code spectateur
-- ---------------------------------------------------------------------

-- Ouvre l'accès spectateur pour la session courante si le code est bon.
-- Limité à 5 échecs par tranche de 10 minutes et par session.
create function public.redeem_spectator_code(p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.app_settings;
  v_failures integer;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select count(*) into v_failures
  from public.spectator_code_attempts
  where user_id = v_uid and not succeeded and attempted_at > now() - interval '10 minutes';
  if v_failures >= 5 then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = 'P0001';
  end if;

  select * into v_settings from public.app_settings where id;
  v_ok := v_settings.spectator_code_hash is not null
    and p_code is not null
    and extensions.crypt(btrim(p_code), v_settings.spectator_code_hash) = v_settings.spectator_code_hash;

  insert into public.spectator_code_attempts (user_id, succeeded) values (v_uid, v_ok);

  if v_ok then
    insert into public.spectator_access (user_id, code_version)
    values (v_uid, v_settings.spectator_code_version)
    on conflict (user_id) do update
      set code_version = excluded.code_version, granted_at = now();
  end if;

  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------
-- Fonctions d'administration (vérifient elles-mêmes le rôle admin)
-- ---------------------------------------------------------------------

-- Change le code spectateur (révoque tous les accès spectateurs en cours).
create function public.admin_set_spectator_code(p_code text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_code is null or char_length(btrim(p_code)) < 4 or char_length(btrim(p_code)) > 40 then
    raise exception 'INVALID_CODE' using errcode = 'P0001';
  end if;

  update public.app_settings
  set spectator_code_hash = extensions.crypt(btrim(p_code), extensions.gen_salt('bf')),
      spectator_code_version = spectator_code_version + 1,
      updated_at = now()
  where id;
end;
$$;

-- Indique si un code spectateur est défini (sans le révéler).
create function public.admin_spectator_code_status()
returns table (is_set boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select s.spectator_code_hash is not null, s.updated_at from public.app_settings s where s.id;
end;
$$;

-- Liste des comptes joueurs avec leur email (réservé à l'admin).
create function public.admin_list_accounts()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.user_role,
  status public.account_status,
  email_confirmed boolean,
  must_change_password boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.status,
           u.email_confirmed_at is not null, p.must_change_password,
           p.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.status <> 'deleted'
    order by p.full_name;
end;
$$;

-- Désactive / réactive un compte. L'admin ne peut pas se désactiver lui-même.
create function public.admin_set_account_status(p_user_id uuid, p_status public.account_status)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status not in ('active', 'disabled') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_OWN_STATUS' using errcode = 'P0001';
  end if;
  update public.profiles set status = p_status where id = p_user_id and status <> 'deleted';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- Renomme un joueur (admin).
create function public.admin_rename_account(p_user_id uuid, p_full_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = p_user_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- Le joueur a choisi un nouveau mot de passe après un mot de passe provisoire.
create function public.clear_must_change_password()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Règles de sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.allowed_email_domains enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.app_settings enable row level security;
alter table public.spectator_access enable row level security;
alter table public.spectator_code_attempts enable row level security;

-- Profils : chacun voit le sien ; les joueurs actifs voient tous les profils. Pas les spectateurs.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active_player());

-- Modification : son propre nom uniquement (droits de colonne ci-dessous) ; le reste passe par les fonctions admin.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_active_player())
  with check (id = auth.uid());

-- Adresses autorisées : gérées et lues par l'admin uniquement.
create policy allowed_email_domains_admin on public.allowed_email_domains
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy allowed_emails_admin on public.allowed_emails
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- app_settings, spectator_access, spectator_code_attempts : aucune politique = inaccessibles
-- directement ; seules les fonctions ci-dessus y touchent.

-- ---------------------------------------------------------------------
-- Droits SQL
-- ---------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

revoke all on public.allowed_email_domains, public.allowed_emails from anon, authenticated;
grant select, insert, delete on public.allowed_email_domains, public.allowed_emails to authenticated;

revoke all on public.app_settings, public.spectator_access, public.spectator_code_attempts from anon, authenticated;

-- Fonctions : fermées par défaut, ouvertes au cas par cas.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_email_allowed(text) to anon, authenticated;
grant execute on function
  public.is_active_player(),
  public.is_admin(),
  public.is_spectator(),
  public.can_view_site(),
  public.my_access(),
  public.redeem_spectator_code(text),
  public.admin_set_spectator_code(text),
  public.admin_spectator_code_status(),
  public.admin_list_accounts(),
  public.admin_set_account_status(uuid, public.account_status),
  public.admin_rename_account(uuid, text),
  public.clear_must_change_password()
to authenticated;

-- Les fonctions futures ne sont pas exécutables par défaut.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
