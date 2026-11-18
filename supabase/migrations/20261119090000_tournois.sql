-- =====================================================================
-- Étape 3 — Tournois
-- Participants (comptes ou noms seuls), tournois, inscriptions, poules,
-- tours, matchs et liens d'avancement dans les tableaux.
--
-- Le tirage (poules, tableau, exempts, 3e place, consolante) est calculé
-- dans le site (src/lib/draw, couvert par des tests) puis enregistré d'un
-- bloc par la fonction admin_launch_tournament.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.discipline as enum ('mini_pong', 'darts');
create type public.tournament_format as enum ('knockout', 'pools_knockout');
create type public.tournament_status as enum ('draft', 'in_progress', 'finished', 'archived');
create type public.qualifier_placement as enum ('classic', 'random');
create type public.bracket_kind as enum ('pool', 'main', 'third_place', 'consolation');
-- pending : à jouer · bye : exempt (un seul joueur, qualifié d'office)
-- played / walkover / cancelled : utilisés à l'étape 4 (scores, forfaits)
create type public.match_status as enum ('pending', 'bye', 'played', 'walkover', 'cancelled');

-- ---------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------
-- Un participant est soit lié à un compte (profile_id), soit un « nom seul » créé par l'admin.
-- full_name est recopié depuis le profil pour les comptes : les spectateurs, qui ne lisent pas
-- les profils, voient ainsi les noms dans les tableaux.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  created_at timestamptz not null default now()
);
comment on table public.players is 'Participants aux tournois : comptes ou « noms seuls ».';

-- ---------------------------------------------------------------------
-- Tournois
-- ---------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 5000),
  discipline public.discipline not null,
  format public.tournament_format not null default 'knockout',
  status public.tournament_status not null default 'draft',
  -- Poules (format pools_knockout uniquement)
  pool_count smallint check (pool_count between 1 and 16),
  qualifiers_per_pool smallint check (qualifiers_per_pool between 1 and 8),
  qualifier_placement public.qualifier_placement not null default 'classic',
  -- Options du tableau
  third_place boolean not null default false,
  consolation boolean not null default false,
  -- Format de jeu par défaut des tours (recopié dans chaque tour au tirage, modifiable ensuite)
  default_sets_to_win smallint not null default 2 check (default_sets_to_win between 1 and 3),
  default_dart_start smallint not null default 301 check (default_dart_start in (301, 501)),
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournaments_pool_options check (
    (format = 'knockout' and pool_count is null and qualifiers_per_pool is null)
    or (format = 'pools_knockout' and pool_count is not null and qualifiers_per_pool is not null)
  )
);

-- Inscriptions (tournoi × participant)
create table public.tournament_entries (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  pool_id uuid,
  created_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);
create index tournament_entries_player_idx on public.tournament_entries (player_id);

create table public.pools (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  label text not null check (label ~ '^[A-Z]$'),
  unique (tournament_id, label)
);

alter table public.tournament_entries
  add constraint tournament_entries_pool_fk foreign key (pool_id) references public.pools (id) on delete set null;

-- Tours : poules, tours du tableau principal, 3e place, consolante. Chacun a son format de jeu.
create table public.tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  bracket public.bracket_kind not null,
  round_number smallint not null check (round_number >= 1),
  name text not null,
  sets_to_win smallint not null check (sets_to_win between 1 and 3),
  dart_start smallint not null check (dart_start in (301, 501)),
  plan_key text not null,
  unique (tournament_id, bracket, round_number),
  unique (tournament_id, plan_key)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_id uuid not null references public.tournament_rounds (id) on delete cascade,
  pool_id uuid references public.pools (id) on delete cascade,
  -- Ordre d'affichage dans le tour (de haut en bas dans le tableau)
  position smallint not null check (position >= 1),
  plan_key text not null,
  home_player_id uuid references public.players (id),
  away_player_id uuid references public.players (id),
  winner_player_id uuid references public.players (id),
  status public.match_status not null default 'pending',
  -- Où va le vainqueur / le perdant (3e place, consolante)
  next_match_id uuid references public.matches (id) on delete set null,
  next_slot text check (next_slot in ('home', 'away')),
  loser_next_match_id uuid references public.matches (id) on delete set null,
  loser_next_slot text check (loser_next_slot in ('home', 'away')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, plan_key),
  check (home_player_id is null or home_player_id is distinct from away_player_id),
  check ((next_match_id is null) = (next_slot is null)),
  check ((loser_next_match_id is null) = (loser_next_slot is null))
);
create index matches_round_idx on public.matches (round_id, position);
create index matches_tournament_idx on public.matches (tournament_id);
create index matches_home_idx on public.matches (home_player_id);
create index matches_away_idx on public.matches (away_player_id);

-- ---------------------------------------------------------------------
-- Déclencheurs
-- ---------------------------------------------------------------------

-- Participant lié à un compte : le nom vient toujours du profil.
create function public.players_sync_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is not null then
    select p.full_name into new.full_name from public.profiles p where p.id = new.profile_id;
    if new.full_name is null then
      raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger players_sync_name
  before insert or update on public.players
  for each row execute function public.players_sync_name();

-- Renommage d'un compte : répercuté sur son participant.
create function public.profiles_propagate_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name then
    update public.players set full_name = new.full_name where profile_id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_propagate_name
  after update of full_name on public.profiles
  for each row execute function public.profiles_propagate_name();

-- Après lancement, la structure du tournoi est figée (sauf nom, description, formats de jeu
-- par défaut et placement des qualifiés, utilisé à la génération de la phase finale).
create function public.tournaments_guard_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.discipline is distinct from old.discipline
    or new.format is distinct from old.format
    or new.pool_count is distinct from old.pool_count
    or new.qualifiers_per_pool is distinct from old.qualifiers_per_pool
    or new.third_place is distinct from old.third_place
    or new.consolation is distinct from old.consolation
  ) then
    raise exception 'CONFIG_LOCKED' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tournaments_guard_config
  before update on public.tournaments
  for each row execute function public.tournaments_guard_config();

create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Fonctions d'aide aux droits
-- ---------------------------------------------------------------------

-- Tournoi visible : l'admin voit tout ; joueurs et spectateurs voient les tournois lancés.
create function public.can_view_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      public.can_view_site()
      and exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.status <> 'draft')
    );
$$;

-- Tournoi en brouillon (inscriptions modifiables).
create function public.is_draft_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.status = 'draft');
$$;

-- Un match du tournoi a-t-il déjà été joué (score, forfait ou annulation) ?
create function public.tournament_has_results(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.matches m
    where m.tournament_id = p_tournament_id and m.status in ('played', 'walkover', 'cancelled')
  );
$$;

-- ---------------------------------------------------------------------
-- Lancement / tirage
-- ---------------------------------------------------------------------
-- p_plan (calculé par src/lib/draw) :
-- {
--   "pools":   [{ "label": "A", "playerIds": [uuid, …] }],
--   "rounds":  [{ "key", "bracket", "roundNumber", "name" }],
--   "matches": [{ "key", "roundKey", "poolLabel", "position", "home", "away", "status", "winner",
--                 "next": { "matchKey", "slot" } | null, "loserNext": { "matchKey", "slot" } | null }]
-- }
-- Remplace tout tirage existant. Possible en brouillon, ou en cours tant qu'aucun match n'est joué.
create function public.admin_launch_tournament(p_tournament_id uuid, p_plan jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_entries uuid[];
  v_planned uuid[];
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_t.status not in ('draft', 'in_progress') then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if public.tournament_has_results(p_tournament_id) then
    raise exception 'TOURNAMENT_HAS_RESULTS' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(player_id order by player_id), '{}') into v_entries
  from public.tournament_entries where tournament_id = p_tournament_id;
  if cardinality(v_entries) < 2 then
    raise exception 'NOT_ENOUGH_PLAYERS' using errcode = 'P0001';
  end if;

  -- Chaque inscrit doit apparaître exactement une fois au départ du tirage :
  -- dans une poule (format avec poules) ou au 1er tour du tableau principal.
  if v_t.format = 'pools_knockout' then
    if jsonb_array_length(coalesce(p_plan -> 'pools', '[]')) <> v_t.pool_count then
      raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'nombre de poules';
    end if;
    select coalesce(array_agg(x::uuid order by x::uuid), '{}') into v_planned
    from jsonb_array_elements(p_plan -> 'pools') p, jsonb_array_elements_text(p -> 'playerIds') x;
  else
    select coalesce(array_agg(x::uuid order by x::uuid), '{}') into v_planned
    from jsonb_array_elements(p_plan -> 'matches') m,
         jsonb_array_elements(p_plan -> 'rounds') r,
         lateral (values (m ->> 'home'), (m ->> 'away')) s (x)
    where r ->> 'key' = m ->> 'roundKey'
      and r ->> 'bracket' = 'main'
      and (r ->> 'roundNumber')::int = 1
      and s.x is not null;
  end if;
  if v_planned is distinct from v_entries then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'joueurs';
  end if;

  -- Remise à zéro de l'ancien tirage
  update public.tournament_entries set pool_id = null where tournament_id = p_tournament_id;
  delete from public.matches where tournament_id = p_tournament_id;
  delete from public.tournament_rounds where tournament_id = p_tournament_id;
  delete from public.pools where tournament_id = p_tournament_id;

  -- Poules
  insert into public.pools (tournament_id, label)
  select p_tournament_id, p ->> 'label' from jsonb_array_elements(coalesce(p_plan -> 'pools', '[]')) p;

  update public.tournament_entries e
  set pool_id = po.id
  from jsonb_array_elements(coalesce(p_plan -> 'pools', '[]')) p
  cross join jsonb_array_elements_text(p -> 'playerIds') x
  join public.pools po on po.tournament_id = p_tournament_id and po.label = p ->> 'label'
  where e.tournament_id = p_tournament_id and e.player_id = x::uuid;

  -- Tours (format de jeu par défaut du tournoi)
  insert into public.tournament_rounds (tournament_id, bracket, round_number, name, sets_to_win, dart_start, plan_key)
  select p_tournament_id,
         (r ->> 'bracket')::public.bracket_kind,
         (r ->> 'roundNumber')::smallint,
         r ->> 'name',
         v_t.default_sets_to_win,
         v_t.default_dart_start,
         r ->> 'key'
  from jsonb_array_elements(p_plan -> 'rounds') r;

  -- Matchs, puis liens d'avancement
  insert into public.matches (
    tournament_id, round_id, pool_id, position, plan_key,
    home_player_id, away_player_id, winner_player_id, status
  )
  select p_tournament_id, r.id, po.id, (m ->> 'position')::smallint, m ->> 'key',
         (m ->> 'home')::uuid, (m ->> 'away')::uuid, (m ->> 'winner')::uuid,
         coalesce(m ->> 'status', 'pending')::public.match_status
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.tournament_rounds r on r.tournament_id = p_tournament_id and r.plan_key = m ->> 'roundKey'
  left join public.pools po on po.tournament_id = p_tournament_id and po.label = m ->> 'poolLabel';

  if (select count(*) from public.matches where tournament_id = p_tournament_id)
     <> jsonb_array_length(p_plan -> 'matches') then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tour inconnu';
  end if;

  update public.matches mm
  set next_match_id = nx.id,
      next_slot = m -> 'next' ->> 'slot'
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.matches nx on nx.tournament_id = p_tournament_id and nx.plan_key = m -> 'next' ->> 'matchKey'
  where mm.tournament_id = p_tournament_id and mm.plan_key = m ->> 'key';

  update public.matches mm
  set loser_next_match_id = nx.id,
      loser_next_slot = m -> 'loserNext' ->> 'slot'
  from jsonb_array_elements(p_plan -> 'matches') m
  join public.matches nx on nx.tournament_id = p_tournament_id and nx.plan_key = m -> 'loserNext' ->> 'matchKey'
  where mm.tournament_id = p_tournament_id and mm.plan_key = m ->> 'key';

  update public.tournaments
  set status = 'in_progress', launched_at = coalesce(launched_at, now())
  where id = p_tournament_id;
end;
$$;

-- Annule le lancement : retour en brouillon (inscriptions conservées), si aucun match joué.
create function public.admin_reset_tournament(p_tournament_id uuid)
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
  if public.tournament_has_results(p_tournament_id) then
    raise exception 'TOURNAMENT_HAS_RESULTS' using errcode = 'P0001';
  end if;

  update public.tournament_entries set pool_id = null where tournament_id = p_tournament_id;
  delete from public.matches where tournament_id = p_tournament_id;
  delete from public.tournament_rounds where tournament_id = p_tournament_id;
  delete from public.pools where tournament_id = p_tournament_id;
  update public.tournaments set status = 'draft', launched_at = null where id = p_tournament_id;
end;
$$;

-- Remplace un participant par un autre dans le tournoi : inscription + matchs pas encore joués.
-- Les matchs déjà joués restent au nom de l'ancien participant (historique).
create function public.admin_replace_player(p_tournament_id uuid, p_old_player_id uuid, p_new_player_id uuid)
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
  perform 1 from public.tournaments where id = p_tournament_id and status in ('draft', 'in_progress') for update;
  if not found then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.players where id = p_new_player_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tournament_entries where tournament_id = p_tournament_id and player_id = p_new_player_id) then
    raise exception 'ALREADY_ENTERED' using errcode = 'P0001';
  end if;

  update public.tournament_entries set player_id = p_new_player_id
  where tournament_id = p_tournament_id and player_id = p_old_player_id;
  if not found then
    raise exception 'NOT_ENTERED' using errcode = 'P0001';
  end if;

  update public.matches
  set home_player_id = case when home_player_id = p_old_player_id then p_new_player_id else home_player_id end,
      away_player_id = case when away_player_id = p_old_player_id then p_new_player_id else away_player_id end,
      winner_player_id = case when winner_player_id = p_old_player_id then p_new_player_id else winner_player_id end
  where tournament_id = p_tournament_id
    and status in ('pending', 'bye')
    and p_old_player_id in (home_player_id, away_player_id);
end;
$$;

-- Cycle de vie après lancement : en cours ↔ terminé ↔ archivé.
create function public.admin_set_tournament_status(p_tournament_id uuid, p_status public.tournament_status)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current public.tournament_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select status into v_current from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (
    (v_current = 'in_progress' and p_status = 'finished')
    or (v_current = 'finished' and p_status in ('in_progress', 'archived'))
    or (v_current = 'archived' and p_status = 'finished')
  ) then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  update public.tournaments set status = p_status where id = p_tournament_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Règles de sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.pools enable row level security;
alter table public.tournament_rounds enable row level security;
alter table public.matches enable row level security;

-- Participants : lisibles par tous les visiteurs autorisés (noms dans les tableaux) ; gérés par l'admin.
create policy players_select on public.players
  for select to authenticated using (public.can_view_site());
create policy players_admin_insert on public.players
  for insert to authenticated with check (public.is_admin());
create policy players_admin_update on public.players
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy players_admin_delete on public.players
  for delete to authenticated using (public.is_admin());

-- Tournois : les brouillons ne sont visibles que par l'admin.
create policy tournaments_select on public.tournaments
  for select to authenticated using (public.can_view_tournament(id));
create policy tournaments_admin_insert on public.tournaments
  for insert to authenticated with check (public.is_admin());
create policy tournaments_admin_update on public.tournaments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tournaments_admin_delete on public.tournaments
  for delete to authenticated using (public.is_admin());

-- Inscriptions : modifiables par l'admin tant que le tournoi est en brouillon.
create policy entries_select on public.tournament_entries
  for select to authenticated using (public.can_view_tournament(tournament_id));
create policy entries_admin_insert on public.tournament_entries
  for insert to authenticated with check (public.is_admin() and public.is_draft_tournament(tournament_id));
create policy entries_admin_delete on public.tournament_entries
  for delete to authenticated using (public.is_admin() and public.is_draft_tournament(tournament_id));

create policy pools_select on public.pools
  for select to authenticated using (public.can_view_tournament(tournament_id));

-- Tours : l'admin peut changer le format de jeu de chaque tour.
create policy rounds_select on public.tournament_rounds
  for select to authenticated using (public.can_view_tournament(tournament_id));
create policy rounds_admin_update on public.tournament_rounds
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy matches_select on public.matches
  for select to authenticated using (public.can_view_tournament(tournament_id));

-- ---------------------------------------------------------------------
-- Droits SQL
-- ---------------------------------------------------------------------
revoke all on public.players, public.tournaments, public.tournament_entries, public.pools,
  public.tournament_rounds, public.matches from anon, authenticated;

grant select, delete on public.players to authenticated;
grant insert (id, profile_id, full_name) on public.players to authenticated;
grant update (full_name) on public.players to authenticated;

grant select, delete on public.tournaments to authenticated;
grant insert (id, name, description, discipline, format, pool_count, qualifiers_per_pool, qualifier_placement,
  third_place, consolation, default_sets_to_win, default_dart_start) on public.tournaments to authenticated;
grant update (name, description, discipline, format, pool_count, qualifiers_per_pool, qualifier_placement,
  third_place, consolation, default_sets_to_win, default_dart_start) on public.tournaments to authenticated;

grant select, delete on public.tournament_entries to authenticated;
grant insert (tournament_id, player_id) on public.tournament_entries to authenticated;

grant select on public.pools, public.matches to authenticated;
grant select on public.tournament_rounds to authenticated;
grant update (sets_to_win, dart_start) on public.tournament_rounds to authenticated;

grant execute on function
  public.can_view_tournament(uuid),
  public.is_draft_tournament(uuid),
  public.admin_launch_tournament(uuid, jsonb),
  public.admin_reset_tournament(uuid),
  public.admin_replace_player(uuid, uuid, uuid),
  public.admin_set_tournament_status(uuid, public.tournament_status)
to authenticated;
