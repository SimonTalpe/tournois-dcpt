-- =====================================================================
-- Étape 5 — Suppression de compte
--
-- Un joueur peut supprimer son compte ; l'admin peut supprimer celui d'un joueur.
-- Le compte est anonymisé : « Joueur supprimé » dans les tableaux et l'historique
-- (résultats conservés), statut 'deleted', notifications effacées.
-- Ensuite, l'Edge Function « delete-account » supprime l'utilisateur d'authentification
-- (suppression « douce » de Supabase : adresse email effacée et libérée, sessions fermées),
-- sans toucher aux résultats qui référencent le profil.
-- =====================================================================

-- Nom affiché des comptes supprimés.
create function public.deleted_player_name()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Joueur supprimé'::text;
$$;

-- Anonymisation (interne, appelée par les fonctions ci-dessous).
create function public.anonymize_account(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set full_name = public.deleted_player_name(),
      status = 'deleted',
      role = 'player',
      must_change_password = false
  where id = p_user_id and status <> 'deleted';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Le nom des participants suit le profil (déclencheur profiles_propagate_name).
  delete from public.notifications where recipient_id = p_user_id;
  delete from public.spectator_access where user_id = p_user_id;
end;
$$;

-- Le joueur supprime son propre compte. Le dernier admin ne peut pas partir.
create function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and status <> 'deleted') then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and role = 'admin')
     and not exists (
       select 1 from public.profiles where role = 'admin' and status = 'active' and id <> v_uid
     ) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;
  perform public.anonymize_account(v_uid);
end;
$$;

-- L'admin supprime le compte d'un autre joueur.
create function public.admin_delete_account(p_user_id uuid)
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
  if p_user_id = auth.uid() then
    raise exception 'CANNOT_DELETE_OWN_ACCOUNT' using errcode = 'P0001';
  end if;
  perform public.anonymize_account(p_user_id);
end;
$$;

-- La suppression d'authentification remplace l'email par une adresse fictive : on ne la contrôle pas.
create or replace function public.check_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email
     and new.email is not null
     and not coalesce(new.is_anonymous, false)
     and not exists (select 1 from public.profiles where id = new.id and status = 'deleted')
     and not public.is_email_allowed(new.email) then
    raise exception 'EMAIL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Un compte supprimé dans un tournoi en cours est signalé à l'admin comme un compte désactivé
-- (remplacer ou déclarer forfait).
create or replace function public.admin_disabled_players_with_pending_matches()
returns table (tournament_id uuid, tournament_name text, player_id uuid, profile_id uuid, full_name text, pending_matches integer)
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
    select t.id, t.name, p.id, p.profile_id, p.full_name, count(m.id)::integer
    from public.tournaments t
    join public.tournament_entries e on e.tournament_id = t.id
    join public.players p on p.id = e.player_id
    join public.profiles pr on pr.id = p.profile_id
    join public.matches m on m.tournament_id = t.id and m.status = 'pending'
      and p.id in (m.home_player_id, m.away_player_id)
    where t.status = 'in_progress' and pr.status in ('disabled', 'deleted')
    group by t.id, t.name, p.id, p.profile_id, p.full_name
    order by t.name, p.full_name;
end;
$$;

grant execute on function
  public.delete_my_account(),
  public.admin_delete_account(uuid)
to authenticated;
