-- =====================================================================
-- Étape 4 — Lieu et horaire des matchs, inversion domicile/extérieur
--
-- - Lieu + horaire proposés par l'un ou l'autre joueur, sans validation de l'adversaire ;
--   les deux peuvent modifier tant que le match n'a pas de résultat. L'admin peut toujours modifier.
-- - Horaire : du lundi au vendredi, par tranches de 15 minutes (heure de Paris).
-- - Lieux : « 2e étage », « 3e étage » + lieux ajoutés par l'admin.
-- - Inversion domicile/extérieur : admin, match sans résultat.
-- =====================================================================

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 40),
  created_at timestamptz not null default now()
);
comment on table public.locations is 'Lieux des matchs (ajoutés par l''admin).';

insert into public.locations (name) values ('2e étage'), ('3e étage');

alter table public.locations enable row level security;
create policy locations_select on public.locations
  for select to authenticated using (public.can_view_site());
create policy locations_admin_insert on public.locations
  for insert to authenticated with check (public.is_admin());
create policy locations_admin_update on public.locations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy locations_admin_delete on public.locations
  for delete to authenticated using (public.is_admin());
revoke all on public.locations from anon, authenticated;
grant select, delete on public.locations to authenticated;
grant insert (name), update (name) on public.locations to authenticated;

alter table public.matches
  add column scheduled_at timestamptz,
  add column location_id uuid references public.locations (id) on delete set null,
  add column schedule_by uuid references public.profiles (id) on delete set null,
  add column schedule_updated_at timestamptz,
  add constraint matches_schedule_slot check (
    scheduled_at is null or (
      extract(isodow from scheduled_at at time zone 'Europe/Paris') between 1 and 5
      and extract(minute from scheduled_at at time zone 'Europe/Paris')::int % 15 = 0
      and extract(second from scheduled_at) = 0
    )
  );

-- Lieu et horaire d'un match (null = non renseigné).
create function public.set_match_schedule(p_match_id uuid, p_scheduled_at timestamptz, p_location_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_status public.tournament_status;
  v_admin boolean := public.is_admin();
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select status into v_status from public.tournaments where id = v_match.tournament_id;

  if not v_admin then
    if not public.is_active_player() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.players p
      where p.profile_id = auth.uid() and p.id in (v_match.home_player_id, v_match.away_player_id)
    ) then
      raise exception 'NOT_MY_MATCH' using errcode = 'P0001';
    end if;
    if v_status <> 'in_progress' then
      raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
    end if;
    if v_match.status <> 'pending' then
      raise exception 'SCHEDULE_LOCKED' using errcode = 'P0001';
    end if;
  elsif v_status not in ('in_progress', 'finished') then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if v_match.status = 'bye' then
    raise exception 'MATCH_NOT_READY' using errcode = 'P0001';
  end if;

  if p_location_id is not null and not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.matches
  set scheduled_at = p_scheduled_at,
      location_id = p_location_id,
      schedule_by = auth.uid(),
      schedule_updated_at = now()
  where id = p_match_id;
end;
$$;

-- Inversion domicile/extérieur (admin, match sans résultat). Les liens des matchs précédents
-- sont inversés aussi, pour que les joueurs à venir arrivent du bon côté.
create function public.admin_swap_home_away(p_match_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_match.status <> 'pending' then
    raise exception 'SWAP_NOT_POSSIBLE' using errcode = 'P0001';
  end if;
  update public.matches
  set home_player_id = v_match.away_player_id, away_player_id = v_match.home_player_id
  where id = p_match_id;
  update public.matches
  set next_slot = case next_slot when 'home' then 'away' else 'home' end
  where next_match_id = p_match_id;
  update public.matches
  set loser_next_slot = case loser_next_slot when 'home' then 'away' else 'home' end
  where loser_next_match_id = p_match_id;
end;
$$;

grant execute on function
  public.set_match_schedule(uuid, timestamptz, uuid),
  public.admin_swap_home_away(uuid)
to authenticated;
