-- =====================================================================
-- Créneaux horaires des matchs : 12:00–13:30 et 17:30–19:00 (heure de Paris, bornes incluses).
-- Contrôlé dans set_match_schedule, uniquement quand l'horaire change : les horaires déjà
-- enregistrés hors de ces plages restent valides et peuvent être conservés tels quels
-- (changement du lieu seul), mais un nouvel horaire doit être dans une plage.
-- =====================================================================

create function public.is_allowed_match_time(p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_at at time zone 'Europe/Paris')::time between time '12:00' and time '13:30'
      or (p_at at time zone 'Europe/Paris')::time between time '17:30' and time '19:00';
$$;

create or replace function public.set_match_schedule(p_match_id uuid, p_scheduled_at timestamptz, p_location_id uuid)
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

  if p_scheduled_at is not null
     and p_scheduled_at is distinct from v_match.scheduled_at
     and not public.is_allowed_match_time(p_scheduled_at) then
    raise exception 'SCHEDULE_OUTSIDE_HOURS' using errcode = 'P0001';
  end if;

  update public.matches
  set scheduled_at = p_scheduled_at,
      location_id = p_location_id,
      schedule_by = auth.uid(),
      schedule_updated_at = now()
  where id = p_match_id;
end;
$$;

revoke execute on function public.is_allowed_match_time(timestamptz) from public, anon, authenticated;
