-- =====================================================================
-- Compteur de fléchettes dans les matchs de tournoi (19/11/2026)
--
-- - Format de jeu des fléchettes : 301/501 (existant), sortie sur double et nombre de manches
--   gagnantes (1 à 3, colonne sets_to_win partagée avec le mini-pong) ; défaut du tournoi,
--   recopié dans chaque tour, modifiable par tour tant qu'aucun match du tour n'est joué.
-- - Score d'un match de fléchettes = manches gagnées (home_legs / away_legs).
-- - Match joué au compteur : record_dart_match enregistre chaque manche dans l'historique
--   du compteur (dart_games, liée au match) et reporte le résultat comme une saisie manuelle
--   (mêmes droits, correction 5 minutes, avancement). Départage de poule : record_dart_tiebreak.
-- - Deux appareils sur le même match : le premier qui valide enregistre, le second est refusé.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sortie sur double
-- ---------------------------------------------------------------------
alter table public.tournaments add column default_dart_double_out boolean not null default false;
alter table public.tournament_rounds add column dart_double_out boolean not null default false;

-- Les tours sont créés par plusieurs fonctions (lancement, phase finale) : la sortie sur double
-- par défaut du tournoi y est recopiée à la création (comme 301/501 et le nombre de sets/manches).
create function public.tournament_rounds_default_double_out()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select t.default_dart_double_out into new.dart_double_out from public.tournaments t where t.id = new.tournament_id;
  return new;
end;
$$;

create trigger tournament_rounds_default_double_out
  before insert on public.tournament_rounds
  for each row execute function public.tournament_rounds_default_double_out();

-- Format d'un tour verrouillé dès qu'un match du tour est joué : la sortie sur double aussi.
create or replace function public.tournament_rounds_guard_format()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.sets_to_win is distinct from old.sets_to_win
      or new.dart_start is distinct from old.dart_start
      or new.dart_double_out is distinct from old.dart_double_out)
     and exists (select 1 from public.matches m where m.round_id = old.id and m.status in ('played', 'walkover')) then
    raise exception 'ROUND_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

grant insert (default_dart_double_out), update (default_dart_double_out) on public.tournaments to authenticated;
grant update (dart_double_out) on public.tournament_rounds to authenticated;

-- ---------------------------------------------------------------------
-- Manches gagnantes : les tournois de fléchettes existants se jouaient en une partie.
-- ---------------------------------------------------------------------
alter table public.tournament_rounds disable trigger tournament_rounds_guard_format;
update public.tournament_rounds r
set sets_to_win = 1
from public.tournaments t
where t.id = r.tournament_id and t.discipline = 'darts';
alter table public.tournament_rounds enable trigger tournament_rounds_guard_format;
update public.tournaments set default_sets_to_win = 1 where discipline = 'darts';

-- ---------------------------------------------------------------------
-- Score en manches (fléchettes) ; effacé dès que le match n'est plus « joué ».
-- ---------------------------------------------------------------------
alter table public.matches
  add column home_legs smallint check (home_legs between 0 and 3),
  add column away_legs smallint check (away_legs between 0 and 3),
  add constraint matches_legs_pair check ((home_legs is null) = (away_legs is null));

update public.matches m
set home_legs = case when m.winner_player_id = m.home_player_id then 1 else 0 end,
    away_legs = case when m.winner_player_id = m.away_player_id then 1 else 0 end
from public.tournaments t
where t.id = m.tournament_id and t.discipline = 'darts' and m.status = 'played';

create function public.matches_clear_legs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'played' then
    new.home_legs := null;
    new.away_legs := null;
  end if;
  return new;
end;
$$;

create trigger matches_clear_legs
  before insert or update on public.matches
  for each row execute function public.matches_clear_legs();

-- ---------------------------------------------------------------------
-- Parties du compteur liées à un match (une par manche) ou à un départage de poule.
-- ---------------------------------------------------------------------
alter table public.dart_games
  add column match_id uuid references public.matches (id) on delete set null,
  add column leg_number smallint check (leg_number between 1 and 5),
  add column tiebreak_id uuid references public.pool_tiebreaks (id) on delete set null,
  add constraint dart_games_leg_pair check ((match_id is null) = (leg_number is null)),
  add constraint dart_games_single_link check (match_id is null or tiebreak_id is null);
create unique index dart_games_match_leg_key on public.dart_games (match_id, leg_number) where match_id is not null;
create index dart_games_tiebreak_idx on public.dart_games (tiebreak_id) where tiebreak_id is not null;

-- Résultat effacé ou corrigé à la main (autre vainqueur ou autre score) : les parties du compteur
-- ne le reflètent plus, on les détache (elles restent dans l'historique).
create function public.matches_detach_dart_games()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'played' and (
    new.status <> 'played'
    or new.winner_player_id is distinct from old.winner_player_id
    or new.home_legs is distinct from old.home_legs
    or new.away_legs is distinct from old.away_legs
  ) then
    update public.dart_games set match_id = null, leg_number = null where match_id = new.id;
  end if;
  return null;
end;
$$;

create trigger matches_detach_dart_games
  after update on public.matches
  for each row execute function public.matches_detach_dart_games();

create function public.pool_tiebreaks_detach_dart_games()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ranking is distinct from old.ranking then
    update public.dart_games set tiebreak_id = null where tiebreak_id = new.id;
  end if;
  return null;
end;
$$;

create trigger pool_tiebreaks_detach_dart_games
  after update on public.pool_tiebreaks
  for each row execute function public.pool_tiebreaks_detach_dart_games();

-- ---------------------------------------------------------------------
-- Saisie ou correction d'un résultat.
-- Mini-pong : p_sets = tableau des sets, p_winner_player_id ignoré.
-- Fléchettes : p_sets = { "home": n, "away": m } (manches gagnées) ; vainqueur déduit.
--   Compatibilité (ancienne version du site en cache) : vainqueur seul accepté si 1 manche gagnante.
-- ---------------------------------------------------------------------
create or replace function public.submit_match_result(p_match_id uuid, p_winner_player_id uuid, p_sets jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_discipline public.discipline;
  v_sets_to_win smallint;
  v_winner uuid;
  v_loser uuid;
  v_changed boolean;
  v_home_legs integer;
  v_away_legs integer;
begin
  v_match := public.check_result_rights(p_match_id);
  select t.discipline, r.sets_to_win into v_discipline, v_sets_to_win
  from public.tournaments t join public.tournament_rounds r on r.id = v_match.round_id
  where t.id = v_match.tournament_id;

  if v_discipline = 'darts' then
    if p_sets is null and v_sets_to_win = 1 then
      if p_winner_player_id is null or p_winner_player_id not in (v_match.home_player_id, v_match.away_player_id) then
        raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'vainqueur';
      end if;
      v_home_legs := case when p_winner_player_id = v_match.home_player_id then 1 else 0 end;
      v_away_legs := 1 - v_home_legs;
    else
      if p_sets is null or jsonb_typeof(p_sets) <> 'object'
         or jsonb_typeof(p_sets -> 'home') <> 'number' or jsonb_typeof(p_sets -> 'away') <> 'number' then
        raise exception 'INVALID_LEGS' using errcode = 'P0001';
      end if;
      v_home_legs := (p_sets ->> 'home')::integer;
      v_away_legs := (p_sets ->> 'away')::integer;
      if least(v_home_legs, v_away_legs) < 0
         or greatest(v_home_legs, v_away_legs) <> v_sets_to_win
         or least(v_home_legs, v_away_legs) >= v_sets_to_win then
        raise exception 'INVALID_LEGS' using errcode = 'P0001';
      end if;
    end if;
    v_winner := case when v_home_legs = v_sets_to_win then v_match.home_player_id else v_match.away_player_id end;
  else
    v_winner := case public.mini_pong_winner(p_sets, v_sets_to_win)
      when 'home' then v_match.home_player_id else v_match.away_player_id end;
  end if;
  v_loser := case when v_winner = v_match.home_player_id then v_match.away_player_id else v_match.home_player_id end;
  v_changed := v_match.status = 'pending' or v_match.winner_player_id is distinct from v_winner;

  -- Correction qui change le vainqueur : on retire d'abord l'ancien avancement.
  if v_match.status = 'played' and v_changed then
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, null);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, null);
  end if;

  update public.matches
  set status = 'played',
      winner_player_id = v_winner,
      home_legs = v_home_legs,
      away_legs = v_away_legs,
      result_by = auth.uid(),
      result_by_admin = public.is_admin(),
      result_first_at = coalesce(result_first_at, now()),
      result_at = now()
  where id = p_match_id;

  delete from public.match_sets where match_id = p_match_id;
  if v_discipline = 'mini_pong' then
    insert into public.match_sets (match_id, set_number, home_points, away_points)
    select p_match_id, s.ordinality, (s.value ->> 'home')::smallint, (s.value ->> 'away')::smallint
    from jsonb_array_elements(p_sets) with ordinality s;
  end if;

  if v_changed then
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, v_winner);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, v_loser);
  end if;
end;
$$;

-- Participants d'une manche (tableau JSON, ordre de jeu) au format de record_dart_game.
create function public.dart_leg_participants(p_players jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', x -> 'player_id', 'rank', x -> 'rank', 'remaining', x -> 'remaining',
    'darts', x -> 'darts', 'points', x -> 'points') order by o), '[]'::jsonb)
  from jsonb_array_elements(p_players) with ordinality t(x, o);
$$;

-- ---------------------------------------------------------------------
-- Match joué au compteur.
-- p_legs : tableau des manches dans l'ordre, chacune
--   { "game_id", "started_at", "players": [{ "player_id", "rank", "remaining", "darts", "points" }, …] }
--   (joueurs dans l'ordre de jeu de la manche).
-- ---------------------------------------------------------------------
create function public.record_dart_match(p_match_id uuid, p_legs jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_round public.tournament_rounds;
  v_discipline public.discipline;
  v_leg jsonb;
  v_number integer := 0;
  v_home_legs integer := 0;
  v_away_legs integer := 0;
  v_ids uuid[];
  v_winners uuid[];
  v_first uuid;
begin
  if jsonb_typeof(p_legs) is distinct from 'array' or jsonb_array_length(p_legs) not between 1 and 5 then
    raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
  end if;
  v_first := (p_legs -> 0 ->> 'game_id')::uuid;

  -- Nouvel essai après une coupure réseau : déjà enregistré par cet appareil.
  if exists (select 1 from public.dart_games where id = v_first) then
    if exists (select 1 from public.dart_games where id = v_first and match_id = p_match_id and created_by = auth.uid()) then
      return;
    end if;
    raise exception 'MATCH_ALREADY_PLAYED' using errcode = 'P0001';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select discipline into v_discipline from public.tournaments where id = v_match.tournament_id;
  if v_discipline <> 'darts' then
    raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
  end if;
  -- Un autre appareil a validé avant : son résultat est conservé.
  if v_match.status = 'played' then
    raise exception 'MATCH_ALREADY_PLAYED' using errcode = 'P0001';
  end if;
  if v_match.status <> 'pending' or v_match.home_player_id is null or v_match.away_player_id is null then
    raise exception 'MATCH_NOT_READY' using errcode = 'P0001';
  end if;
  select * into v_round from public.tournament_rounds where id = v_match.round_id;

  for v_leg in select value from jsonb_array_elements(p_legs) loop
    if v_home_legs = v_round.sets_to_win or v_away_legs = v_round.sets_to_win
       or jsonb_typeof(v_leg -> 'players') is distinct from 'array' or jsonb_array_length(v_leg -> 'players') <> 2 then
      raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
    end if;
    select array_agg((x ->> 'player_id')::uuid order by (x ->> 'player_id')::uuid) into v_ids
    from jsonb_array_elements(v_leg -> 'players') x;
    if v_ids is distinct from (select array_agg(p order by p)
                               from unnest(array[v_match.home_player_id, v_match.away_player_id]) p) then
      raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
    end if;
    select array_agg((x ->> 'player_id')::uuid) into v_winners
    from jsonb_array_elements(v_leg -> 'players') x
    where (x ->> 'rank')::integer = 1 and (x ->> 'remaining')::integer = 0;
    if cardinality(v_winners) is distinct from 1 then
      raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
    end if;
    if v_winners[1] = v_match.home_player_id then
      v_home_legs := v_home_legs + 1;
    else
      v_away_legs := v_away_legs + 1;
    end if;
  end loop;
  if greatest(v_home_legs, v_away_legs) <> v_round.sets_to_win then
    raise exception 'INVALID_DART_MATCH' using errcode = 'P0001';
  end if;

  -- Résultat du match : mêmes droits et même avancement qu'une saisie manuelle.
  perform public.submit_match_result(p_match_id, null, jsonb_build_object('home', v_home_legs, 'away', v_away_legs));

  -- Chaque manche rejoint l'historique du compteur, liée au match.
  for v_leg in select value from jsonb_array_elements(p_legs) loop
    v_number := v_number + 1;
    perform public.record_dart_game((v_leg ->> 'game_id')::uuid, v_round.dart_start, v_round.dart_double_out, 'finished',
      (v_leg ->> 'started_at')::timestamptz, public.dart_leg_participants(v_leg -> 'players'));
    update public.dart_games set match_id = p_match_id, leg_number = v_number where id = (v_leg ->> 'game_id')::uuid;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Départage de poule joué au compteur (partie à plusieurs jouée jusqu'au bout).
-- p_players : joueurs dans l'ordre de jeu { "player_id", "rank", "remaining", "darts", "points" }.
-- ---------------------------------------------------------------------
create function public.record_dart_tiebreak(p_pool_id uuid, p_game_id uuid, p_started_at timestamptz, p_players jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round public.tournament_rounds;
  v_ranking uuid[];
  v_sorted uuid[];
  v_ranks integer[];
begin
  if exists (select 1 from public.dart_games where id = p_game_id) then
    if exists (select 1 from public.dart_games where id = p_game_id and tiebreak_id is not null and created_by = auth.uid()) then
      return;
    end if;
    raise exception 'TIEBREAK_ALREADY_SET' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) < 2 then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;

  select array_agg((x ->> 'player_id')::uuid order by (x ->> 'rank')::integer),
         array_agg((x ->> 'rank')::integer order by (x ->> 'rank')::integer)
  into v_ranking, v_ranks
  from jsonb_array_elements(p_players) x;
  -- Partie jouée jusqu'au bout : places 1 à n, sans ex aequo.
  if v_ranks is distinct from (select array_agg(i order by i) from generate_series(1, cardinality(v_ranking)) i) then
    raise exception 'INVALID_DART_GAME' using errcode = 'P0001';
  end if;
  select array_agg(x order by x) into v_sorted from unnest(v_ranking) x;

  perform 1 from public.pools where id = p_pool_id for update;
  -- Un autre appareil a validé avant : son classement est conservé.
  if exists (select 1 from public.pool_tiebreaks where pool_id = p_pool_id and player_ids = v_sorted) then
    raise exception 'TIEBREAK_ALREADY_SET' using errcode = 'P0001';
  end if;

  -- Classement du départage : mêmes droits et mêmes règles qu'une saisie manuelle.
  perform public.submit_pool_tiebreak(p_pool_id, v_ranking);

  select r.* into v_round
  from public.matches m join public.tournament_rounds r on r.id = m.round_id
  where m.pool_id = p_pool_id
  limit 1;
  perform public.record_dart_game(p_game_id, v_round.dart_start, v_round.dart_double_out, 'finished', p_started_at,
    public.dart_leg_participants(p_players));
  update public.dart_games
  set tiebreak_id = (select id from public.pool_tiebreaks where pool_id = p_pool_id and player_ids = v_sorted)
  where id = p_game_id;
end;
$$;

revoke all on function public.record_dart_match(uuid, jsonb) from public, anon;
revoke all on function public.record_dart_tiebreak(uuid, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.dart_leg_participants(jsonb) from public, anon;
grant execute on function public.record_dart_match(uuid, jsonb) to authenticated;
grant execute on function public.record_dart_tiebreak(uuid, uuid, timestamptz, jsonb) to authenticated;
