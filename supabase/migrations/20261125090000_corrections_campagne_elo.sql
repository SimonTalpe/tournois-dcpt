-- =====================================================================
-- Corrections de la campagne de tests de l'Elo (23/11/2026)
--
-- 1. Elo : plus d'interblocage sous saisies simultanées.
-- Problème : chaque modification marquait les deux disciplines « à recalculer » en mettant à jour
-- les deux lignes de elo_state, et le recalcul verrouillait aussi ces lignes : deux transactions
-- simultanées pouvaient les verrouiller dans un ordre différent → « deadlock detected » (≈ 7 % des
-- opérations dans le test de concurrence à 8 clients).
--
-- Correction : les modifications ajoutent simplement une ligne dans un journal (elo_dirty), sans
-- verrou partagé. Le recalcul d'une discipline (seul à verrouiller sa ligne de elo_state) vide
-- d'abord le journal, puis recalcule : une modification validée pendant le recalcul y est incluse
-- (lecture postérieure) ; une modification validée après laisse sa ligne de journal → recalcul
-- à la lecture suivante. Aucune modification n'est perdue.
--
-- 2. Rattachement nom seul → compte (fusion) : échouait si le nom seul avait été déclaré forfait
--    (matches.forfeit_player_id n'était pas transféré → erreur de clé étrangère). Corrigé, et les
--    matchs classés sont aussi transférés (par sécurité : un nom seul n'en joue pas).
-- =====================================================================

create table public.elo_dirty (
  id bigint generated always as identity primary key,
  discipline public.discipline not null,
  created_at timestamptz not null default now()
);
alter table public.elo_dirty enable row level security;
revoke all on public.elo_dirty from anon, authenticated;

-- Reprise de l'état actuel : tout recalculer à la prochaine lecture.
insert into public.elo_dirty (discipline) values ('mini_pong'), ('darts');
alter table public.elo_state drop column dirty;

create or replace function public.elo_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.elo_dirty (discipline) values ('mini_pong'), ('darts');
  return null;
end;
$$;

create or replace function public.elo_refresh(p_discipline public.discipline)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pending integer;
  v_ratings jsonb := '{}'::jsonb;
  v_event record;
  v_entry jsonb;
  v_home_rating integer;
  v_home_games integer;
  v_away_rating integer;
  v_away_games integer;
  v_expected double precision;
  v_home_score integer;
  v_delta integer;
begin
  -- Un seul recalcul à la fois par discipline (les modifications, elles, ne verrouillent rien ici).
  perform 1 from public.elo_state where discipline = p_discipline for update;
  -- Journal vidé AVANT la lecture des matchs : rien de ce qui est validé ensuite n'est perdu.
  with done as (delete from public.elo_dirty where discipline = p_discipline returning 1)
  select count(*) into v_pending from done;
  if v_pending = 0 then
    return;
  end if;
  delete from public.elo_history where discipline = p_discipline;

  for v_event in
    select * from (
      select 'tournament'::text as source, m.id, coalesce(m.result_first_at, m.updated_at) as played_at,
             m.home_player_id as home_id, hp.profile_id is not null as home_account,
             m.away_player_id as away_id, ap.profile_id is not null as away_account,
             m.winner_player_id as winner_id
      from public.matches m
      join public.tournaments t on t.id = m.tournament_id
      join public.players hp on hp.id = m.home_player_id
      join public.players ap on ap.id = m.away_player_id
      where t.discipline = p_discipline
        and m.status = 'played'
        and m.winner_player_id is not null
        and (hp.profile_id is not null or ap.profile_id is not null)
      union all
      select 'ranked'::text, r.id, r.played_at,
             r.home_player_id, hp.profile_id is not null,
             r.away_player_id, ap.profile_id is not null,
             r.winner_player_id
      from public.ranked_matches r
      join public.players hp on hp.id = r.home_player_id
      join public.players ap on ap.id = r.away_player_id
      where r.discipline = p_discipline
    ) e
    order by e.played_at, e.id
  loop
    v_home_rating := 1200; v_home_games := 0;
    v_away_rating := 1200; v_away_games := 0;
    if v_event.home_account then
      v_entry := v_ratings -> v_event.home_id::text;
      if v_entry is not null then
        v_home_rating := (v_entry ->> 'r')::integer;
        v_home_games := (v_entry ->> 'g')::integer;
      end if;
    end if;
    if v_event.away_account then
      v_entry := v_ratings -> v_event.away_id::text;
      if v_entry is not null then
        v_away_rating := (v_entry ->> 'r')::integer;
        v_away_games := (v_entry ->> 'g')::integer;
      end if;
    end if;

    v_expected := 1 / (1 + power(10::double precision, (v_away_rating - v_home_rating) / 400.0));
    v_home_score := case when v_event.winner_id = v_event.home_id then 1 else 0 end;

    if v_event.home_account then
      v_delta := round((public.elo_k(v_home_games) * (v_home_score - v_expected))::numeric)::integer;
      insert into public.elo_history (discipline, player_id, seq, source, match_id, played_at, opponent_player_id,
                                      won, rating_before, rating_after, delta)
      values (p_discipline, v_event.home_id, v_home_games + 1, v_event.source, v_event.id, v_event.played_at,
              v_event.away_id, v_home_score = 1, v_home_rating, v_home_rating + v_delta, v_delta);
      v_ratings := v_ratings || jsonb_build_object(v_event.home_id::text,
        jsonb_build_object('r', v_home_rating + v_delta, 'g', v_home_games + 1));
    end if;
    if v_event.away_account then
      v_delta := round((public.elo_k(v_away_games) * ((1 - v_home_score) - (1 - v_expected)))::numeric)::integer;
      insert into public.elo_history (discipline, player_id, seq, source, match_id, played_at, opponent_player_id,
                                      won, rating_before, rating_after, delta)
      values (p_discipline, v_event.away_id, v_away_games + 1, v_event.source, v_event.id, v_event.played_at,
              v_event.home_id, v_home_score = 0, v_away_rating, v_away_rating + v_delta, v_delta);
      v_ratings := v_ratings || jsonb_build_object(v_event.away_id::text,
        jsonb_build_object('r', v_away_rating + v_delta, 'g', v_away_games + 1));
    end if;
  end loop;

  update public.elo_state set refreshed_at = now() where discipline = p_discipline;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Rattachement nom seul → compte : forfaits (et matchs classés) transférés aussi.
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
      winner_player_id = case when winner_player_id = p_player_id then v_target else winner_player_id end,
      forfeit_player_id = case when forfeit_player_id = p_player_id then v_target else forfeit_player_id end
  where p_player_id in (home_player_id, away_player_id, winner_player_id, forfeit_player_id);
  -- Départages de poule déjà saisis : la fiche du compte remplace le nom seul (groupe trié + classement).
  update public.pool_tiebreaks
  set player_ids = (select array_agg(x order by x) from unnest(array_replace(player_ids, p_player_id, v_target)) x),
      ranking = array_replace(ranking, p_player_id, v_target)
  where p_player_id = any (player_ids);
  update public.dart_game_players set player_id = v_target where player_id = p_player_id;
  update public.ranked_matches
  set home_player_id = case when home_player_id = p_player_id then v_target else home_player_id end,
      away_player_id = case when away_player_id = p_player_id then v_target else away_player_id end,
      winner_player_id = case when winner_player_id = p_player_id then v_target else winner_player_id end
  where p_player_id in (home_player_id, away_player_id);
  delete from public.players where id = p_player_id;
  return v_target;
end;
$$;
