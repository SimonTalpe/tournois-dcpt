-- =====================================================================
-- Étape 4 — Campagne de tests : corrections
--
-- Fusion nom seul → compte : les départages de poule déjà saisis suivent la fusion
-- (sinon l'égalité réapparaissait comme « à départager »).
-- =====================================================================

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
  delete from public.players where id = p_player_id;
  return v_target;
end;
$$;

