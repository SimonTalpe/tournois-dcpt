-- =====================================================================
-- Étape 4 — Forfaits, annulation de match, compte désactivé
--
-- - Forfait (admin) : le joueur déclaré forfait perd le match, son adversaire est qualifié.
--   Si l'adversaire n'est pas encore connu (tableau), il est qualifié dès son arrivée.
--   Le joueur forfait part en 3e place / consolante comme un perdant (il peut y être déclaré forfait aussi).
-- - Annulation (admin) : matchs de poule uniquement ; un match annulé est ignoré du classement.
-- - « Rétablir » : un forfait ou une annulation redevient un match à jouer.
-- - Compte désactivé dans un tournoi en cours : forfait sur tous ses matchs non joués (s'il n'est pas remplacé).
-- =====================================================================

alter table public.matches
  add column forfeit_player_id uuid references public.players (id),
  add constraint matches_forfeit_consistency check (
    (status = 'walkover') = (forfeit_player_id is not null)
  );

-- ---------------------------------------------------------------------
-- Avancement dans un match forfait (reprise de place_in_match, étape « saisie des scores ») :
-- comme pour un exempt, le joueur qui arrive face à un joueur forfait est qualifié d'office,
-- et cette qualification automatique suit les corrections du match précédent.
-- Seule la place du joueur forfait lui-même ne peut plus changer.
-- ---------------------------------------------------------------------
create or replace function public.place_in_match(p_match_id uuid, p_slot text, p_player_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_current uuid;
begin
  if p_match_id is null then
    return;
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  v_current := case when p_slot = 'home' then v_match.home_player_id else v_match.away_player_id end;
  if v_match.status = 'played'
     or (v_match.status = 'walkover' and v_current is not distinct from v_match.forfeit_player_id) then
    raise exception 'NEXT_MATCH_PLAYED' using errcode = 'P0001';
  end if;

  -- Forfait : on retire d'abord la qualification automatique précédente.
  if v_match.status = 'walkover' and v_match.winner_player_id is not null then
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, null);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, null);
    update public.matches set winner_player_id = null where id = p_match_id;
  end if;

  if p_slot = 'home' then
    update public.matches set home_player_id = p_player_id where id = p_match_id;
  else
    update public.matches set away_player_id = p_player_id where id = p_match_id;
  end if;

  if v_match.status = 'bye' then
    update public.matches set winner_player_id = p_player_id where id = p_match_id;
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, p_player_id);
  elsif v_match.status = 'walkover' and p_player_id is not null then
    update public.matches set winner_player_id = p_player_id where id = p_match_id;
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, p_player_id);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, v_match.forfeit_player_id);
  end if;
end;
$$;

-- Contrôles communs aux actions de l'admin sur un match. Renvoie le match verrouillé.
create function public.check_admin_match_action(p_match_id uuid)
returns public.matches
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_status public.tournament_status;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select status into v_status from public.tournaments where id = v_match.tournament_id;
  if v_status not in ('in_progress', 'finished') then
    raise exception 'TOURNAMENT_CLOSED' using errcode = 'P0001';
  end if;
  if v_match.pool_id is not null and public.has_final_phase(v_match.tournament_id) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  return v_match;
end;
$$;

-- Forfait de p_forfeit_player_id sur un match à jouer.
create function public.admin_set_walkover(p_match_id uuid, p_forfeit_player_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_winner uuid;
begin
  v_match := public.check_admin_match_action(p_match_id);
  if v_match.status <> 'pending' then
    raise exception 'MATCH_NOT_PENDING' using errcode = 'P0001';
  end if;
  if p_forfeit_player_id is null or p_forfeit_player_id not in (v_match.home_player_id, v_match.away_player_id) then
    raise exception 'NOT_IN_MATCH' using errcode = 'P0001';
  end if;
  v_winner := case when p_forfeit_player_id = v_match.home_player_id then v_match.away_player_id else v_match.home_player_id end;

  update public.matches
  set status = 'walkover',
      forfeit_player_id = p_forfeit_player_id,
      winner_player_id = v_winner,
      result_by = auth.uid(),
      result_by_admin = true,
      result_first_at = now(),
      result_at = now()
  where id = p_match_id;
  delete from public.match_sets where match_id = p_match_id;

  -- Adversaire connu : avancement immédiat ; sinon, à son arrivée (place_in_match).
  if v_winner is not null then
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, v_winner);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, p_forfeit_player_id);
  end if;
end;
$$;

-- Annulation d'un match de poule (ignoré du classement).
create function public.admin_cancel_match(p_match_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  v_match := public.check_admin_match_action(p_match_id);
  if v_match.pool_id is null then
    raise exception 'CANCEL_POOL_ONLY' using errcode = 'P0001';
  end if;
  if v_match.status <> 'pending' then
    raise exception 'MATCH_NOT_PENDING' using errcode = 'P0001';
  end if;
  update public.matches
  set status = 'cancelled', winner_player_id = null,
      result_by = auth.uid(), result_by_admin = true, result_first_at = now(), result_at = now()
  where id = p_match_id;
end;
$$;

-- Rétablit un match forfait ou annulé : il redevient « à jouer ».
create function public.admin_reopen_match(p_match_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  v_match := public.check_admin_match_action(p_match_id);
  if v_match.status not in ('walkover', 'cancelled') then
    raise exception 'MATCH_NOT_REOPENABLE' using errcode = 'P0001';
  end if;
  if v_match.status = 'walkover' and v_match.winner_player_id is not null then
    perform public.place_in_match(v_match.next_match_id, v_match.next_slot, null);
    perform public.place_in_match(v_match.loser_next_match_id, v_match.loser_next_slot, null);
  end if;
  update public.matches
  set status = 'pending', winner_player_id = null, forfeit_player_id = null,
      result_by = null, result_by_admin = false, result_first_at = null, result_at = null
  where id = p_match_id;
end;
$$;

-- Forfait d'un joueur sur tous ses matchs non joués du tournoi (compte désactivé non remplacé…).
-- Répété tant qu'il en reste : un joueur forfait peut être envoyé en 3e place / consolante.
-- Renvoie le nombre de matchs déclarés forfait.
create function public.admin_forfeit_player(p_tournament_id uuid, p_player_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tournament_entries where tournament_id = p_tournament_id and player_id = p_player_id) then
    raise exception 'NOT_ENTERED' using errcode = 'P0001';
  end if;
  loop
    select m.id into v_match_id
    from public.matches m
    where m.tournament_id = p_tournament_id
      and m.status = 'pending'
      and p_player_id in (m.home_player_id, m.away_player_id)
      and not (m.pool_id is not null and public.has_final_phase(p_tournament_id))
    order by m.created_at, m.position
    limit 1;
    exit when v_match_id is null;
    perform public.admin_set_walkover(v_match_id, p_player_id);
    v_count := v_count + 1;
    v_match_id := null;
    if v_count > 200 then
      raise exception 'FORFEIT_LOOP' using errcode = 'P0001';
    end if;
  end loop;
  return v_count;
end;
$$;

-- Participants (comptes désactivés) ayant encore des matchs à jouer dans un tournoi en cours (admin).
create function public.admin_disabled_players_with_pending_matches()
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
    where t.status = 'in_progress' and pr.status = 'disabled'
    group by t.id, t.name, p.id, p.profile_id, p.full_name
    order by t.name, p.full_name;
end;
$$;

grant execute on function
  public.admin_set_walkover(uuid, uuid),
  public.admin_cancel_match(uuid),
  public.admin_reopen_match(uuid),
  public.admin_forfeit_player(uuid, uuid),
  public.admin_disabled_players_with_pending_matches()
to authenticated;
