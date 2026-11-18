-- =====================================================================
-- Étape 4 — Départages de poule et génération de la phase finale
--
-- Les classements de poule sont calculés dans le site (src/lib/standings, testé).
-- La base enregistre :
-- - les départages : classement complet d'un groupe de joueurs à égalité
--   (partie de fléchettes à plusieurs saisie par un joueur concerné ou l'admin ;
--   égalité parfaite au mini-pong : décision de l'admin) ;
-- - la phase finale, calculée par le site (buildFinalPhase) et enregistrée d'un bloc par l'admin.
-- Une fois la phase finale générée, les résultats de poule sont figés (annuler la phase finale d'abord).
-- =====================================================================

create table public.pool_tiebreaks (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  -- Joueurs à égalité (triés) et leur classement après départage
  player_ids uuid[] not null,
  ranking uuid[] not null,
  result_by uuid references public.profiles (id) on delete set null,
  result_by_admin boolean not null default false,
  result_first_at timestamptz not null default now(),
  result_at timestamptz not null default now(),
  unique (pool_id, player_ids),
  check (cardinality(player_ids) >= 2 and cardinality(ranking) = cardinality(player_ids))
);
comment on table public.pool_tiebreaks is 'Départages de poule : classement complet d''un groupe à égalité.';

alter table public.pool_tiebreaks enable row level security;
create policy pool_tiebreaks_select on public.pool_tiebreaks
  for select to authenticated using (
    exists (select 1 from public.pools p where p.id = pool_id and public.can_view_tournament(p.tournament_id))
  );
revoke all on public.pool_tiebreaks from anon, authenticated;
grant select on public.pool_tiebreaks to authenticated;

-- Phase finale générée ? (au moins un tour hors poules)
create function public.has_final_phase(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tournament_rounds r where r.tournament_id = p_tournament_id and r.bracket <> 'pool'
  );
$$;

-- Tous les matchs de la poule ont un résultat (ou sont annulés) ?
create function public.pool_is_finished(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.matches m where m.pool_id = p_pool_id and m.status not in ('played', 'walkover', 'cancelled')
  );
$$;

-- ---------------------------------------------------------------------
-- Résultats de poule figés après génération de la phase finale
-- (reprise de check_result_rights, étape « saisie des scores », avec ce contrôle en plus)
-- ---------------------------------------------------------------------
create or replace function public.check_result_rights(p_match_id uuid)
returns public.matches
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
  end if;

  if not (v_status = 'in_progress' or (v_admin and v_status = 'finished')) then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if v_match.pool_id is not null and public.has_final_phase(v_match.tournament_id) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  if v_match.status not in ('pending', 'played')
     or v_match.home_player_id is null or v_match.away_player_id is null then
    raise exception 'MATCH_NOT_READY' using errcode = 'P0001';
  end if;

  if v_match.status = 'played' and not v_admin and (
    v_match.result_by_admin
    or v_match.result_by is distinct from auth.uid()
    or now() > v_match.result_first_at + interval '5 minutes'
  ) then
    raise exception 'RESULT_LOCKED' using errcode = 'P0001';
  end if;
  return v_match;
end;
$$;

-- ---------------------------------------------------------------------
-- Départage : p_ranking = classement complet (du 1er au dernier) des joueurs à égalité.
-- Fléchettes : un joueur concerné ou l'admin ; mini-pong : l'admin.
-- Correction : l'auteur pendant 5 minutes (sauf départage saisi par l'admin), sinon l'admin.
-- ---------------------------------------------------------------------
create function public.submit_pool_tiebreak(p_pool_id uuid, p_ranking uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments;
  v_admin boolean := public.is_admin();
  v_sorted uuid[];
  v_existing public.pool_tiebreaks;
begin
  select t.* into v_tournament
  from public.pools p join public.tournaments t on t.id = p.tournament_id
  where p.id = p_pool_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_sorted from (select distinct unnest(p_ranking) x) d;
  if cardinality(v_sorted) < 2 or cardinality(v_sorted) <> cardinality(p_ranking)
     or exists (
       select 1 from unnest(v_sorted) x
       where not exists (select 1 from public.tournament_entries e where e.pool_id = p_pool_id and e.player_id = x)
     ) then
    raise exception 'INVALID_TIEBREAK' using errcode = 'P0001';
  end if;

  if not v_admin then
    if not public.is_active_player() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if v_tournament.discipline <> 'darts' then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if not exists (select 1 from public.players p where p.profile_id = auth.uid() and p.id = any (v_sorted)) then
      raise exception 'NOT_MY_MATCH' using errcode = 'P0001';
    end if;
  end if;

  if not (v_tournament.status = 'in_progress' or (v_admin and v_tournament.status = 'finished')) then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if public.has_final_phase(v_tournament.id) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  if not public.pool_is_finished(p_pool_id) then
    raise exception 'POOL_NOT_FINISHED' using errcode = 'P0001';
  end if;

  select * into v_existing from public.pool_tiebreaks where pool_id = p_pool_id and player_ids = v_sorted for update;
  if found and not v_admin and (
    v_existing.result_by_admin
    or v_existing.result_by is distinct from auth.uid()
    or now() > v_existing.result_first_at + interval '5 minutes'
  ) then
    raise exception 'RESULT_LOCKED' using errcode = 'P0001';
  end if;

  insert into public.pool_tiebreaks (pool_id, player_ids, ranking, result_by, result_by_admin)
  values (p_pool_id, v_sorted, p_ranking, auth.uid(), v_admin)
  on conflict (pool_id, player_ids) do update
  set ranking = excluded.ranking,
      result_by = excluded.result_by,
      result_by_admin = excluded.result_by_admin,
      result_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Phase finale : enregistrement d'un plan calculé par le site (même format que admin_launch_tournament,
-- sans poules). Possible quand toutes les poules sont terminées et qu'aucune phase finale n'existe.
-- ---------------------------------------------------------------------
create function public.admin_generate_final_phase(p_tournament_id uuid, p_plan jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_expected integer;
  v_main_players uuid[];
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_t.status <> 'in_progress' then
    raise exception 'NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;
  if v_t.format <> 'pools_knockout' then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tournoi sans poules';
  end if;
  if public.has_final_phase(p_tournament_id) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pools p where p.tournament_id = p_tournament_id and not public.pool_is_finished(p.id)) then
    raise exception 'POOL_NOT_FINISHED' using errcode = 'P0001';
  end if;

  -- Contrôles du plan : aucune poule ni tour de poule ; joueurs tous inscrits ;
  -- 1er tour du tableau principal = nombre de qualifiés attendu, sans doublon.
  if jsonb_array_length(coalesce(p_plan -> 'pools', '[]')) > 0
     or exists (select 1 from jsonb_array_elements(p_plan -> 'rounds') r where r ->> 'bracket' not in ('main', 'third_place', 'consolation')) then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tours';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_plan -> 'matches') m,
         lateral (values (m ->> 'home'), (m ->> 'away'), (m ->> 'winner')) s (x)
    where s.x is not null
      and not exists (select 1 from public.tournament_entries e where e.tournament_id = p_tournament_id and e.player_id = s.x::uuid)
  ) then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'joueurs';
  end if;
  select coalesce(array_agg(distinct s.x::uuid), '{}') into v_main_players
  from jsonb_array_elements(p_plan -> 'matches') m,
       jsonb_array_elements(p_plan -> 'rounds') r,
       lateral (values (m ->> 'home'), (m ->> 'away')) s (x)
  where r ->> 'key' = m ->> 'roundKey' and r ->> 'bracket' = 'main' and (r ->> 'roundNumber')::int = 1 and s.x is not null;
  select count(*) * v_t.qualifiers_per_pool into v_expected from public.pools where tournament_id = p_tournament_id;
  if cardinality(v_main_players) <> v_expected then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'qualifiés';
  end if;

  insert into public.tournament_rounds (tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
  select p_tournament_id, (r ->> 'bracket')::public.bracket_kind, (r ->> 'roundNumber')::smallint, r ->> 'name',
         v_t.default_sets_to_win, v_t.default_dart_start, r ->> 'key'
  from jsonb_array_elements(p_plan -> 'rounds') r;

  insert into public.matches (tournament_id, round_id, pool_id, position, plan_key,
    home_player_id, away_player_id, winner_player_id, status)
  select p_tournament_id, r.id, null, (m ->> 'position')::smallint, m ->> 'key',
         (m ->> 'home')::uuid, (m ->> 'away')::uuid, (m ->> 'winner')::uuid,
         coalesce(m ->> 'status', 'pending')::public.match_status
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.tournament_rounds r on r.tournament_id = p_tournament_id and r.plan_key = m ->> 'roundKey'
  where r.bracket <> 'pool';

  if (select count(*) from public.matches mm join public.tournament_rounds r on r.id = mm.round_id
      where mm.tournament_id = p_tournament_id and r.bracket <> 'pool') <> jsonb_array_length(p_plan -> 'matches') then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tour inconnu';
  end if;

  update public.matches mm
  set next_match_id = nx.id, next_slot = m -> 'next' ->> 'slot'
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.matches nx on nx.tournament_id = p_tournament_id and nx.plan_key = m -> 'next' ->> 'matchKey'
  where mm.tournament_id = p_tournament_id and mm.plan_key = m ->> 'key';

  update public.matches mm
  set loser_next_match_id = nx.id, loser_next_slot = m -> 'loserNext' ->> 'slot'
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.matches nx on nx.tournament_id = p_tournament_id and nx.plan_key = m -> 'loserNext' ->> 'matchKey'
  where mm.tournament_id = p_tournament_id and mm.plan_key = m ->> 'key';
end;
$$;

-- Annule la phase finale (tant qu'aucun de ses matchs n'est joué) : les poules redeviennent modifiables.
create function public.admin_reset_final_phase(p_tournament_id uuid)
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
  perform 1 from public.tournaments where id = p_tournament_id and status = 'in_progress' for update;
  if not found then
    raise exception 'NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.matches m join public.tournament_rounds r on r.id = m.round_id
    where m.tournament_id = p_tournament_id and r.bracket <> 'pool' and m.status in ('played', 'walkover', 'cancelled')
  ) then
    raise exception 'TOURNAMENT_HAS_RESULTS' using errcode = 'P0001';
  end if;
  delete from public.matches m using public.tournament_rounds r
  where r.id = m.round_id and m.tournament_id = p_tournament_id and r.bracket <> 'pool';
  delete from public.tournament_rounds where tournament_id = p_tournament_id and bracket <> 'pool';
end;
$$;

grant execute on function
  public.submit_pool_tiebreak(uuid, uuid[]),
  public.admin_generate_final_phase(uuid, jsonb),
  public.admin_reset_final_phase(uuid)
to authenticated;
