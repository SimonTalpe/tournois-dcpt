-- =====================================================================
-- Compteur de fléchettes (nouvelle fonctionnalité, 19/11/2026)
--
-- La partie se joue sur l'appareil qui tient le compteur (état sauvegardé sur l'appareil) ;
-- seul le résultat final est enregistré ici, pour l'historique et le futur classement Elo.
-- - Joueurs connectés uniquement (les spectateurs jouent en mode local, rien n'est enregistré).
-- - Participants : comptes, « noms seuls » existants, ou nouveaux noms seuls créés à l'enregistrement.
-- - Partie annulée (arrêtée sans aucun joueur ayant fini) : rien n'est enregistré.
-- =====================================================================

create table public.dart_games (
  id uuid primary key,
  created_by uuid not null references public.profiles (id),
  start_score smallint not null check (start_score in (301, 501)),
  double_out boolean not null,
  -- finished : tous les joueurs ont fini (le dernier classé d'office) ; stopped : arrêtée en cours.
  status text not null check (status in ('finished', 'stopped')),
  player_count smallint not null check (player_count between 1 and 10),
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
comment on table public.dart_games is 'Parties du compteur de fléchettes (résultat final uniquement).';

create table public.dart_game_players (
  game_id uuid not null references public.dart_games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  turn_order smallint not null check (turn_order between 1 and 10),
  rank smallint not null check (rank between 1 and 10),
  finished boolean not null,
  remaining smallint not null check (remaining between 0 and 501),
  darts integer not null check (darts >= 0),
  points integer not null check (points >= 0),
  primary key (game_id, player_id),
  unique (game_id, turn_order),
  check (finished = (remaining = 0))
);
create index dart_game_players_player_idx on public.dart_game_players (player_id);

alter table public.dart_games enable row level security;
alter table public.dart_game_players enable row level security;

-- Lecture : joueurs connectés (historique, futur classement). Écriture : fonction ci-dessous uniquement.
create policy dart_games_select on public.dart_games
  for select to authenticated using (public.is_active_player());
create policy dart_game_players_select on public.dart_game_players
  for select to authenticated using (public.is_active_player());
create policy dart_games_admin_delete on public.dart_games
  for delete to authenticated using (public.is_admin());

revoke all on public.dart_games, public.dart_game_players from anon, authenticated;
grant select, delete on public.dart_games to authenticated;
grant select on public.dart_game_players to authenticated;

-- ---------------------------------------------------------------------
-- Personnes proposées dans la configuration d'une partie (joueurs connectés) :
-- comptes actifs à l'email confirmé et tous les « noms seuls ».
-- ---------------------------------------------------------------------
create function public.dart_list_people()
returns table (kind text, id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_player() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select 'account'::text, p.id, p.full_name
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.status = 'active' and u.email_confirmed_at is not null
    union all
    select 'name_only'::text, pl.id, pl.full_name
    from public.players pl
    where pl.profile_id is null
    order by 3;
end;
$$;

-- ---------------------------------------------------------------------
-- Enregistrement du résultat d'une partie.
-- p_game_id : identifiant choisi par l'appareil (un nouvel essai après une coupure réseau
--   ne crée pas de doublon : la partie déjà enregistrée est simplement renvoyée).
-- p_participants : tableau JSON, dans l'ordre de jeu, d'objets
--   { "profile_id" | "player_id" | "new_name", "rank", "remaining", "darts", "points" }.
-- ---------------------------------------------------------------------
create function public.record_dart_game(
  p_game_id uuid,
  p_start_score smallint,
  p_double_out boolean,
  p_status text,
  p_started_at timestamptz,
  p_participants jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_item jsonb;
  v_order integer := 0;
  v_player uuid;
  v_name text;
  v_ids uuid[] := '{}';
  v_ranks integer[] := '{}';
  v_finished integer := 0;
  v_remaining integer;
begin
  if not public.is_active_player() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.dart_games where id = p_game_id) then
    if exists (select 1 from public.dart_games where id = p_game_id and created_by = auth.uid()) then
      return p_game_id;
    end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_participants) is distinct from 'array' then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_participants);
  if v_count < 1 or v_count > 10 or p_status not in ('finished', 'stopped') or p_started_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;

  insert into public.dart_games (id, created_by, start_score, double_out, status, player_count, started_at)
  values (p_game_id, auth.uid(), p_start_score, p_double_out, p_status, v_count, least(p_started_at, now()));

  for v_item in select value from jsonb_array_elements(p_participants) loop
    v_order := v_order + 1;
    v_player := null;
    if v_item ? 'profile_id' then
      if not exists (select 1 from public.profiles where id = (v_item ->> 'profile_id')::uuid and status <> 'deleted') then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      select id into v_player from public.players where profile_id = (v_item ->> 'profile_id')::uuid;
      if v_player is null then
        -- Le nom est recopié du profil par la base.
        insert into public.players (profile_id, full_name) values ((v_item ->> 'profile_id')::uuid, '--')
        returning id into v_player;
      end if;
    elsif v_item ? 'player_id' then
      select id into v_player from public.players where id = (v_item ->> 'player_id')::uuid;
      if v_player is null then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
    elsif v_item ? 'new_name' then
      v_name := btrim(v_item ->> 'new_name');
      -- Pas deux « noms seuls » identiques : un nom seul de même nom est réutilisé.
      select id into v_player from public.players
      where profile_id is null and lower(full_name) = lower(v_name)
      limit 1;
      if v_player is null then
        insert into public.players (full_name) values (v_name) returning id into v_player;
      end if;
    else
      raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
    end if;

    if v_player = any (v_ids) then
      raise exception 'DUPLICATE_DART_PLAYER' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_player;
    v_remaining := (v_item ->> 'remaining')::integer;
    if v_remaining > p_start_score then
      raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
    end if;
    if v_remaining = 0 then
      v_finished := v_finished + 1;
    end if;
    v_ranks := v_ranks || (v_item ->> 'rank')::integer;

    insert into public.dart_game_players (game_id, player_id, turn_order, rank, finished, remaining, darts, points)
    values (p_game_id, v_player, v_order, (v_item ->> 'rank')::smallint, v_remaining = 0, v_remaining,
            (v_item ->> 'darts')::integer, (v_item ->> 'points')::integer);
  end loop;

  -- Au moins un joueur a fini ; partie « finished » : tous ont fini sauf le dernier (classé d'office).
  if v_finished = 0
     or (p_status = 'finished' and v_finished < v_count - 1)
     or (p_status = 'stopped' and v_finished >= v_count - 1 and v_count > 1) then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;
  -- Ceux qui ont fini occupent les premières places, sans doublon.
  if exists (
    select 1 from public.dart_game_players
    where game_id = p_game_id and finished
    group by rank having count(*) > 1
  ) or exists (
    select 1 from public.dart_game_players
    where game_id = p_game_id and (finished and rank > v_finished or not finished and rank <= v_finished)
  ) then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;
  return p_game_id;
end;
$$;

revoke all on function public.dart_list_people() from public, anon;
revoke all on function public.record_dart_game(uuid, smallint, boolean, text, timestamptz, jsonb) from public, anon;
grant execute on function public.dart_list_people() to authenticated;
grant execute on function public.record_dart_game(uuid, smallint, boolean, text, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Rattachement nom seul → compte : les parties de fléchettes suivent aussi.
-- ---------------------------------------------------------------------
create or replace function public.admin_link_player_to_account(p_player_id uuid, p_profile_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player public.players;
  v_target uuid;
  v_conflict text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_player from public.players where id = p_player_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_player.profile_id is not null then
    raise exception 'NOT_NAME_ONLY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and status <> 'deleted') then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select id into v_target from public.players where profile_id = p_profile_id for update;

  -- Le compte n'a pas encore de fiche : le nom seul devient sa fiche (nom recopié du profil).
  if v_target is null then
    update public.players set profile_id = p_profile_id where id = p_player_id;
    return p_player_id;
  end if;

  -- Fusion : impossible si les deux fiches jouent dans un même tournoi.
  select t.name into v_conflict
  from public.tournaments t
  where (
      exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and e.player_id = p_player_id)
      or exists (select 1 from public.matches m where m.tournament_id = t.id
                 and p_player_id in (m.home_player_id, m.away_player_id, m.winner_player_id))
    ) and (
      exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and e.player_id = v_target)
      or exists (select 1 from public.matches m where m.tournament_id = t.id
                 and v_target in (m.home_player_id, m.away_player_id, m.winner_player_id))
    )
  limit 1;
  if v_conflict is not null then
    raise exception 'MERGE_CONFLICT' using errcode = 'P0001', detail = v_conflict;
  end if;
  -- Ni dans une même partie du compteur de fléchettes (un joueur ne peut y figurer qu'une fois).
  if exists (
    select 1 from public.dart_game_players a
    join public.dart_game_players b on b.game_id = a.game_id
    where a.player_id = p_player_id and b.player_id = v_target
  ) then
    raise exception 'MERGE_CONFLICT_DART_GAME' using errcode = 'P0001';
  end if;

  update public.tournament_entries set player_id = v_target where player_id = p_player_id;
  update public.matches
  set home_player_id = case when home_player_id = p_player_id then v_target else home_player_id end,
      away_player_id = case when away_player_id = p_player_id then v_target else away_player_id end,
      winner_player_id = case when winner_player_id = p_player_id then v_target else winner_player_id end
  where p_player_id in (home_player_id, away_player_id, winner_player_id);
  -- Départages de poule déjà saisis : la fiche du compte remplace le nom seul (groupe trié + classement).
  update public.pool_tiebreaks
  set player_ids = (select array_agg(x order by x) from unnest(array_replace(player_ids, p_player_id, v_target)) x),
      ranking = array_replace(ranking, p_player_id, v_target)
  where p_player_id = any (player_ids);
  update public.dart_game_players set player_id = v_target where player_id = p_player_id;
  delete from public.players where id = p_player_id;
  return v_target;
end;
$$;
