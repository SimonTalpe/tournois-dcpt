-- =====================================================================
-- Étape 4 — Saisie des scores et avancement automatique
--
-- - Mini-pong : score de chaque set (11 points, 2 points d'écart) ; vainqueur déduit des sets.
-- - Fléchettes : vainqueur uniquement.
-- - Saisie par l'un des deux joueurs ou l'admin, validation immédiate.
-- - Correction : par l'auteur pendant 5 minutes après la 1re saisie, ensuite admin seul.
--   Un résultat saisi (ou corrigé) par l'admin n'est modifiable que par l'admin.
-- - Traçabilité : qui a saisi, quand.
-- - Avancement : vainqueur → match suivant, perdant → 3e place / consolante ;
--   un joueur qui arrive dans un match « exempt » est qualifié d'office (consolante).
-- - Format de jeu d'un tour verrouillé dès qu'un match du tour est joué.
-- =====================================================================

alter table public.matches
  add column result_by uuid references public.profiles (id) on delete set null,
  add column result_by_admin boolean not null default false,
  add column result_first_at timestamptz,
  add column result_at timestamptz;

-- Scores des sets (mini-pong)
create table public.match_sets (
  match_id uuid not null references public.matches (id) on delete cascade,
  set_number smallint not null check (set_number between 1 and 5),
  home_points smallint not null check (home_points between 0 and 99),
  away_points smallint not null check (away_points between 0 and 99),
  primary key (match_id, set_number)
);
comment on table public.match_sets is 'Score de chaque set (mini-pong).';

alter table public.match_sets enable row level security;
create policy match_sets_select on public.match_sets
  for select to authenticated using (
    exists (select 1 from public.matches m where m.id = match_id and public.can_view_tournament(m.tournament_id))
  );
revoke all on public.match_sets from anon, authenticated;
grant select on public.match_sets to authenticated;

-- ---------------------------------------------------------------------
-- Règles du mini-pong
-- ---------------------------------------------------------------------
-- Renvoie 'home' ou 'away' (vainqueur du match) ou lève INVALID_SCORE.
-- p_sets : [{ "home": 11, "away": 8 }, …]
create function public.mini_pong_winner(p_sets jsonb, p_sets_to_win integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_set jsonb;
  v_home integer;
  v_away integer;
  v_home_sets integer := 0;
  v_away_sets integer := 0;
begin
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'aucun set';
  end if;
  for v_set in select value from jsonb_array_elements(p_sets) loop
    if v_home_sets = p_sets_to_win or v_away_sets = p_sets_to_win then
      raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'set de trop';
    end if;
    if jsonb_typeof(v_set -> 'home') <> 'number' or jsonb_typeof(v_set -> 'away') <> 'number' then
      raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'score manquant';
    end if;
    v_home := (v_set ->> 'home')::integer;
    v_away := (v_set ->> 'away')::integer;
    if v_home < 0 or v_away < 0 or v_home > 99 or v_away > 99
       or greatest(v_home, v_away) < 11
       or abs(v_home - v_away) < 2
       or (greatest(v_home, v_away) > 11 and abs(v_home - v_away) <> 2) then
      raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = format('set %s-%s', v_home, v_away);
    end if;
    if v_home > v_away then v_home_sets := v_home_sets + 1; else v_away_sets := v_away_sets + 1; end if;
  end loop;
  if v_home_sets = p_sets_to_win then return 'home'; end if;
  if v_away_sets = p_sets_to_win then return 'away'; end if;
  raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'match inachevé';
end;
$$;

-- ---------------------------------------------------------------------
-- Avancement dans les tableaux
-- ---------------------------------------------------------------------
-- Place (ou retire, si p_player_id est null) un joueur à une place d'un match.
-- Match « exempt » : le joueur arrivé est qualifié d'office et poursuit au match suivant.
-- Refusé si le match visé a déjà un résultat.
create function public.place_in_match(p_match_id uuid, p_slot text, p_player_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  if p_match_id is null then
    return;
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.status in ('played', 'walkover') then
    raise exception 'NEXT_MATCH_PLAYED' using errcode = 'P0001';
  end if;
  if p_slot = 'home' then
    update public.matches set home_player_id = p_player_id where id = p_match_id;
  else
    update public.matches set away_player_id = p_player_id where id = p_match_id;
  end if;
  if v_match.status = 'bye' then
    update public.matches set winner_player_id = p_player_id where id = p_match_id;
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, p_player_id);
  end if;
end;
$$;

-- Contrôles communs à la saisie et à l'effacement d'un résultat. Renvoie le match verrouillé.
create function public.check_result_rights(p_match_id uuid)
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
  if v_match.status not in ('pending', 'played')
     or v_match.home_player_id is null or v_match.away_player_id is null then
    raise exception 'MATCH_NOT_READY' using errcode = 'P0001';
  end if;

  -- Correction : l'auteur pendant 5 minutes (sauf résultat saisi par l'admin), sinon l'admin.
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

-- Saisie ou correction d'un résultat.
-- Mini-pong : p_sets obligatoire, p_winner_player_id ignoré. Fléchettes : p_winner_player_id, pas de sets.
create function public.submit_match_result(p_match_id uuid, p_winner_player_id uuid, p_sets jsonb)
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
begin
  v_match := public.check_result_rights(p_match_id);
  select t.discipline, r.sets_to_win into v_discipline, v_sets_to_win
  from public.tournaments t join public.tournament_rounds r on r.id = v_match.round_id
  where t.id = v_match.tournament_id;

  if v_discipline = 'darts' then
    if p_sets is not null and jsonb_typeof(p_sets) = 'array' and jsonb_array_length(p_sets) > 0 then
      raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'pas de sets aux fléchettes';
    end if;
    if p_winner_player_id is null or p_winner_player_id not in (v_match.home_player_id, v_match.away_player_id) then
      raise exception 'INVALID_SCORE' using errcode = 'P0001', detail = 'vainqueur';
    end if;
    v_winner := p_winner_player_id;
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

-- Effacement d'un résultat (retour « à jouer »), mêmes droits que la correction.
create function public.clear_match_result(p_match_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  v_match := public.check_result_rights(p_match_id);
  if v_match.status <> 'played' then
    return;
  end if;
  perform public.place_in_match(v_match.next_match_id, v_match.next_slot, null);
  perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, null);
  delete from public.match_sets where match_id = p_match_id;
  update public.matches
  set status = 'pending', winner_player_id = null,
      result_by = null, result_by_admin = false, result_first_at = null, result_at = null
  where id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Format de jeu d'un tour verrouillé dès qu'un match du tour est joué (décision du 18/11)
-- ---------------------------------------------------------------------
create function public.tournament_rounds_guard_format()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.sets_to_win is distinct from old.sets_to_win or new.dart_start is distinct from old.dart_start)
     and exists (select 1 from public.matches m where m.round_id = old.id and m.status in ('played', 'walkover')) then
    raise exception 'ROUND_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger tournament_rounds_guard_format
  before update on public.tournament_rounds
  for each row execute function public.tournament_rounds_guard_format();

grant execute on function
  public.submit_match_result(uuid, uuid, jsonb),
  public.clear_match_result(uuid)
to authenticated;
