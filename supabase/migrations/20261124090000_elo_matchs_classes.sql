-- =====================================================================
-- Elo, matchs classés et leaderboard (fonctionnalité 3, 23/11/2026)
--
-- - Un Elo par discipline, départ 1200 ; K = 40 pendant les 10 premiers matchs, puis 20 ;
--   résultat binaire (le score n'influe pas). Adversaire sans compte (nom seul) en tournoi :
--   Elo fixe 1200, jamais mis à jour.
-- - Matchs qui comptent : matchs de tournoi joués (au moins un compte ; forfaits, annulés,
--   exempts et départages exclus) et matchs classés.
-- - L'Elo est recalculé en rejouant tout l'historique dans l'ordre chronologique : toute
--   modification (saisie, correction, effacement, rattachement…) marque la discipline « à
--   recalculer » ; le recalcul est fait à la lecture suivante (elo_refresh).
-- - Match classé : format unique (mini-pong 1 set de 11, fléchettes 1 manche 301 sortie simple),
--   saisi par l'un des deux joueurs (ou l'admin), validé immédiatement, adversaire notifié ;
--   correction/effacement 24 h par l'auteur, ensuite admin seul ; 3 par jour au plus contre
--   le même adversaire (par discipline).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Matchs classés
-- ---------------------------------------------------------------------
create table public.ranked_matches (
  id uuid primary key,
  discipline public.discipline not null,
  -- home = le joueur qui a saisi (ou le 1er joueur choisi par l'admin) ; information d'affichage.
  home_player_id uuid not null references public.players (id),
  away_player_id uuid not null references public.players (id),
  winner_player_id uuid not null references public.players (id),
  -- Mini-pong : score du set.
  home_points smallint check (home_points between 0 and 99),
  away_points smallint check (away_points between 0 and 99),
  -- Fléchettes : reste du perdant (facultatif en saisie manuelle).
  loser_remaining smallint check (loser_remaining between 1 and 301),
  -- Partie du compteur à l'origine du match (détachée si le résultat est corrigé à la main).
  dart_game_id uuid unique references public.dart_games (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  created_by_admin boolean not null default false,
  -- Date du match = date de saisie.
  played_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranked_matches_distinct_players check (home_player_id <> away_player_id),
  constraint ranked_matches_winner check (winner_player_id in (home_player_id, away_player_id)),
  constraint ranked_matches_score check (
    (discipline = 'mini_pong' and home_points is not null and away_points is not null and loser_remaining is null)
    or (discipline = 'darts' and home_points is null and away_points is null)
  )
);
comment on table public.ranked_matches is 'Matchs classés (hors tournoi), comptés pour l''Elo.';
create index ranked_matches_home_idx on public.ranked_matches (home_player_id);
create index ranked_matches_away_idx on public.ranked_matches (away_player_id);
create index ranked_matches_played_idx on public.ranked_matches (discipline, played_at);

create trigger ranked_matches_touch_updated_at
  before update on public.ranked_matches
  for each row execute function public.touch_updated_at();

alter table public.ranked_matches enable row level security;
-- Lecture : joueurs connectés (historique). Écriture : fonctions uniquement.
create policy ranked_matches_select on public.ranked_matches
  for select to authenticated using (public.is_active_player());
revoke all on public.ranked_matches from anon, authenticated;
grant select on public.ranked_matches to authenticated;

-- ---------------------------------------------------------------------
-- Elo : historique calculé (cache reconstruit par elo_refresh) et état « à recalculer »
-- ---------------------------------------------------------------------
create table public.elo_state (
  discipline public.discipline primary key,
  dirty boolean not null default true,
  refreshed_at timestamptz
);
insert into public.elo_state (discipline) values ('mini_pong'), ('darts');

-- Une ligne par compte et par match Elo (les noms seuls n'ont pas d'Elo).
create table public.elo_history (
  discipline public.discipline not null,
  player_id uuid not null,
  -- Numéro du match Elo du joueur dans la discipline (1, 2, 3…).
  seq integer not null check (seq >= 1),
  source text not null check (source in ('tournament', 'ranked')),
  match_id uuid not null,
  played_at timestamptz not null,
  opponent_player_id uuid not null,
  won boolean not null,
  rating_before integer not null,
  rating_after integer not null,
  delta integer not null,
  primary key (discipline, player_id, seq),
  check (rating_after = rating_before + delta)
);
create index elo_history_match_idx on public.elo_history (match_id);

alter table public.elo_state enable row level security;
alter table public.elo_history enable row level security;
-- Aucun accès direct : lecture par get_elo_history uniquement.
revoke all on public.elo_state, public.elo_history from anon, authenticated;

-- Paramètres du calcul.
create function public.elo_k(p_games integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_games < 10 then 40 else 20 end;
$$;

-- Toute modification qui peut changer l'Elo marque les deux disciplines « à recalculer ».
create function public.elo_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.elo_state set dirty = true where not dirty;
  return null;
end;
$$;

create trigger matches_elo_dirty
  after update of status, winner_player_id, home_player_id, away_player_id, result_first_at or delete
  on public.matches
  for each statement execute function public.elo_mark_dirty();
create trigger ranked_matches_elo_dirty
  after insert or update or delete on public.ranked_matches
  for each statement execute function public.elo_mark_dirty();
create trigger players_elo_dirty
  after update of profile_id or delete on public.players
  for each statement execute function public.elo_mark_dirty();

-- ---------------------------------------------------------------------
-- Recalcul complet d'une discipline (si elle est marquée « à recalculer »).
-- Ordre chronologique : 1re saisie du résultat (tournoi) ou date du match classé, puis identifiant.
-- ---------------------------------------------------------------------
create function public.elo_refresh(p_discipline public.discipline)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dirty boolean;
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
  select dirty into v_dirty from public.elo_state where discipline = p_discipline for update;
  if v_dirty is not true then
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

  update public.elo_state set dirty = false, refreshed_at = now() where discipline = p_discipline;
end;
$$;

-- ---------------------------------------------------------------------
-- Lecture de l'historique Elo (leaderboard, profil, courbe) : joueurs et spectateurs.
-- p_player_id : un seul joueur (profil) ; null : tous les comptes (leaderboard).
-- ---------------------------------------------------------------------
create function public.get_elo_history(p_discipline public.discipline, p_player_id uuid default null)
returns table (
  player_id uuid,
  profile_id uuid,
  full_name text,
  account_status public.account_status,
  seq integer,
  source text,
  match_id uuid,
  played_at timestamptz,
  opponent_player_id uuid,
  opponent_name text,
  won boolean,
  rating_before integer,
  rating_after integer,
  delta integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.can_view_site() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform public.elo_refresh(p_discipline);
  return query
    select h.player_id, p.profile_id, p.full_name, pr.status, h.seq, h.source, h.match_id, h.played_at,
           h.opponent_player_id, o.full_name, h.won, h.rating_before, h.rating_after, h.delta
    from public.elo_history h
    join public.players p on p.id = h.player_id
    left join public.profiles pr on pr.id = p.profile_id
    join public.players o on o.id = h.opponent_player_id
    where h.discipline = p_discipline
      and (p_player_id is null or h.player_id = p_player_id)
    order by h.player_id, h.seq;
end;
$$;

revoke all on function public.elo_k(integer) from public, anon;
revoke all on function public.elo_mark_dirty() from public, anon, authenticated;
revoke all on function public.elo_refresh(public.discipline) from public, anon, authenticated;
revoke all on function public.get_elo_history(public.discipline, uuid) from public, anon;
grant execute on function public.get_elo_history(public.discipline, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Participants : une fiche joueur liée à un compte apparaît aussi pour les joueurs connectés
-- dès qu'elle a joué un match classé (lien vers son profil depuis le leaderboard).
-- ---------------------------------------------------------------------
create or replace function public.can_view_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (select 1 from public.players p where p.id = p_player_id and p.profile_id = auth.uid())
    or (
      public.can_view_site()
      and (
        exists (
          select 1 from public.tournament_entries e
          join public.tournaments t on t.id = e.tournament_id
          where e.player_id = p_player_id and t.status <> 'draft'
        )
        or exists (
          select 1 from public.matches m
          join public.tournaments t on t.id = m.tournament_id
          where t.status <> 'draft'
            and p_player_id in (m.home_player_id, m.away_player_id, m.winner_player_id)
        )
      )
    )
    or (
      public.is_active_player()
      and exists (select 1 from public.ranked_matches r where p_player_id in (r.home_player_id, r.away_player_id))
    );
$$;

-- ---------------------------------------------------------------------
-- Notifications : match classé enregistré (ou corrigé) → les joueurs du match autres que l'auteur.
-- ---------------------------------------------------------------------
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in ('announcement', 'ranked_match')),
  add column ranked_match_id uuid references public.ranked_matches (id) on delete cascade,
  add column actor_id uuid references public.profiles (id) on delete set null,
  add column elo_delta integer,
  add column recipient_won boolean,
  add constraint notifications_ranked_check check (kind <> 'ranked_match' or ranked_match_id is not null);
create index notifications_ranked_idx on public.notifications (ranked_match_id) where ranked_match_id is not null;

create function public.ranked_notify(p_ranked_match_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_discipline public.discipline;
begin
  select discipline into v_discipline from public.ranked_matches where id = p_ranked_match_id;
  delete from public.notifications where ranked_match_id = p_ranked_match_id;
  perform public.elo_refresh(v_discipline);
  insert into public.notifications (recipient_id, kind, ranked_match_id, actor_id, elo_delta, recipient_won)
  select pl.profile_id, 'ranked_match', r.id, auth.uid(), h.delta, r.winner_player_id = pl.id
  from public.ranked_matches r
  join public.players pl on pl.id in (r.home_player_id, r.away_player_id)
  join public.profiles pr on pr.id = pl.profile_id and pr.status = 'active'
  left join public.elo_history h
    on h.discipline = r.discipline and h.source = 'ranked' and h.match_id = r.id and h.player_id = pl.id
  where r.id = p_ranked_match_id
    and pl.profile_id is distinct from auth.uid();
end;
$$;

-- Marque comme lues les notifications de la session : toutes, celles d'une annonce, celles d'un type
-- (la page Annonces ne marque que les annonces) ou une notification précise.
drop function public.mark_notifications_read(uuid);
create function public.mark_notifications_read(
  p_announcement_id uuid default null,
  p_kind text default null,
  p_notification_id uuid default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and (p_announcement_id is null or announcement_id = p_announcement_id)
    and (p_kind is null or kind = p_kind)
    and (p_notification_id is null or id = p_notification_id)
    and (announcement_id is null or public.announcement_is_live(announcement_id));
$$;
revoke all on function public.mark_notifications_read(uuid, text, uuid) from public, anon;
grant execute on function public.mark_notifications_read(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Saisie d'un match classé
-- ---------------------------------------------------------------------

-- Fiche joueur d'un compte actif à l'email confirmé (créée au besoin).
create function public.ranked_player_for_profile(p_profile_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_profile_id and p.status = 'active' and u.email_confirmed_at is not null
  ) then
    raise exception 'RANKED_PLAYER_INACTIVE' using errcode = 'P0001';
  end if;
  select id into v_player from public.players where profile_id = p_profile_id;
  if v_player is null then
    -- Le nom est recopié du profil par la base.
    insert into public.players (profile_id, full_name) values (p_profile_id, '--') returning id into v_player;
  end if;
  return v_player;
end;
$$;

-- Score d'un match classé (format unique).
-- Mini-pong : { "home": 11, "away": 8 } (1 set de 11, 2 points d'écart).
-- Fléchettes : { "winner": "home" | "away", "loser_remaining": 47 | null }.
-- Renvoie { "winner": "home" | "away", "home_points", "away_points", "loser_remaining" }.
create function public.ranked_score(p_discipline public.discipline, p_score jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_remaining jsonb;
begin
  if p_score is null or jsonb_typeof(p_score) <> 'object' then
    raise exception 'INVALID_RANKED_SCORE' using errcode = 'P0001';
  end if;
  if p_discipline = 'mini_pong' then
    return jsonb_build_object(
      'winner', public.mini_pong_winner(jsonb_build_array(p_score), 1),
      'home_points', (p_score ->> 'home')::integer,
      'away_points', (p_score ->> 'away')::integer,
      'loser_remaining', null);
  end if;
  v_remaining := p_score -> 'loser_remaining';
  if p_score ->> 'winner' is null or p_score ->> 'winner' not in ('home', 'away')
     or (v_remaining is not null and jsonb_typeof(v_remaining) <> 'null'
         and (jsonb_typeof(v_remaining) <> 'number' or (v_remaining #>> '{}')::numeric not between 1 and 301
              or (v_remaining #>> '{}')::numeric <> trunc((v_remaining #>> '{}')::numeric))) then
    raise exception 'INVALID_RANKED_SCORE' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'winner', p_score ->> 'winner',
    'home_points', null,
    'away_points', null,
    'loser_remaining', case when jsonb_typeof(v_remaining) = 'number' then (v_remaining #>> '{}')::integer end);
end;
$$;

-- Écarts d'Elo d'un match classé : { "home_delta", "away_delta" } (après recalcul).
create function public.ranked_deltas(p_ranked_match_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.ranked_matches;
begin
  select * into v_match from public.ranked_matches where id = p_ranked_match_id;
  perform public.elo_refresh(v_match.discipline);
  return jsonb_build_object(
    'id', v_match.id,
    'home_delta', (select delta from public.elo_history where discipline = v_match.discipline and source = 'ranked'
                   and match_id = v_match.id and player_id = v_match.home_player_id),
    'away_delta', (select delta from public.elo_history where discipline = v_match.discipline and source = 'ranked'
                   and match_id = v_match.id and player_id = v_match.away_player_id));
end;
$$;

-- Enregistrement. p_id : identifiant choisi par l'appareil (nouvel essai après une coupure réseau :
-- pas de doublon). Joueur : il doit être l'un des deux joueurs ; admin : deux comptes quelconques.
create function public.record_ranked_match(
  p_id uuid,
  p_discipline public.discipline,
  p_home_profile_id uuid,
  p_away_profile_id uuid,
  p_score jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_home uuid;
  v_away uuid;
  v_score jsonb;
  v_today_count integer;
begin
  if not public.is_active_player() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.ranked_matches where id = p_id) then
    if exists (select 1 from public.ranked_matches where id = p_id and created_by = auth.uid()) then
      return public.ranked_deltas(p_id);
    end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_home_profile_id is null or p_away_profile_id is null or p_home_profile_id = p_away_profile_id then
    raise exception 'RANKED_SELF' using errcode = 'P0001';
  end if;
  if not v_admin and auth.uid() not in (p_home_profile_id, p_away_profile_id) then
    raise exception 'NOT_MY_MATCH' using errcode = 'P0001';
  end if;
  v_score := public.ranked_score(p_discipline, p_score);
  v_home := public.ranked_player_for_profile(p_home_profile_id);
  v_away := public.ranked_player_for_profile(p_away_profile_id);

  -- 3 matchs classés par jour (heure de Paris) au plus contre le même adversaire, par discipline.
  perform pg_advisory_xact_lock(hashtext('ranked:' || least(v_home, v_away)::text || greatest(v_home, v_away)::text));
  select count(*) into v_today_count
  from public.ranked_matches
  where discipline = p_discipline
    and least(home_player_id, away_player_id) = least(v_home, v_away)
    and greatest(home_player_id, away_player_id) = greatest(v_home, v_away)
    and (played_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date;
  if v_today_count >= 3 and not v_admin then
    raise exception 'RANKED_DAILY_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.ranked_matches (id, discipline, home_player_id, away_player_id, winner_player_id,
                                     home_points, away_points, loser_remaining, created_by, created_by_admin)
  values (p_id, p_discipline, v_home, v_away,
          case when v_score ->> 'winner' = 'home' then v_home else v_away end,
          (v_score ->> 'home_points')::smallint, (v_score ->> 'away_points')::smallint,
          (v_score ->> 'loser_remaining')::smallint, auth.uid(),
          v_admin and auth.uid() not in (p_home_profile_id, p_away_profile_id));
  perform public.ranked_notify(p_id);
  return public.ranked_deltas(p_id);
end;
$$;

-- Droits de correction / effacement : l'auteur pendant 24 h (sauf saisie de l'admin pour d'autres),
-- ensuite l'admin seul.
create function public.check_ranked_rights(p_id uuid)
returns public.ranked_matches
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.ranked_matches;
begin
  if not public.is_active_player() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_match from public.ranked_matches where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (
    v_match.created_by is distinct from auth.uid()
    or v_match.created_by_admin
    or now() > v_match.played_at + interval '24 hours'
  ) then
    raise exception 'RANKED_LOCKED' using errcode = 'P0001';
  end if;
  return v_match;
end;
$$;

create function public.correct_ranked_match(p_id uuid, p_score jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match public.ranked_matches;
  v_score jsonb;
  v_winner uuid;
begin
  v_match := public.check_ranked_rights(p_id);
  v_score := public.ranked_score(v_match.discipline, p_score);
  v_winner := case when v_score ->> 'winner' = 'home' then v_match.home_player_id else v_match.away_player_id end;
  update public.ranked_matches
  set winner_player_id = v_winner,
      home_points = (v_score ->> 'home_points')::smallint,
      away_points = (v_score ->> 'away_points')::smallint,
      loser_remaining = (v_score ->> 'loser_remaining')::smallint,
      -- Résultat corrigé à la main : la partie du compteur ne le reflète plus (elle reste dans l'historique).
      dart_game_id = case
        when v_winner = v_match.winner_player_id
             and (v_score ->> 'loser_remaining')::smallint is not distinct from v_match.loser_remaining
        then dart_game_id end
  where id = p_id;
  perform public.ranked_notify(p_id);
  return public.ranked_deltas(p_id);
end;
$$;

create function public.delete_ranked_match(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.check_ranked_rights(p_id);
  -- Notifications supprimées en cascade ; la partie du compteur reste dans l'historique.
  delete from public.ranked_matches where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Match classé joué au compteur (2 comptes, 301, sortie simple, 1 manche).
-- p_players : les deux joueurs dans l'ordre de jeu
--   { "profile_id", "rank", "remaining", "darts", "points" } ; le vainqueur a fini (rang 1, reste 0).
-- Identifiant du match classé = identifiant de la partie (nouvel essai : pas de doublon).
-- ---------------------------------------------------------------------
create function public.record_ranked_dart_game(p_game_id uuid, p_started_at timestamptz, p_players jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_first jsonb;
  v_second jsonb;
  v_winner jsonb;
  v_loser jsonb;
  v_result jsonb;
begin
  if not public.is_active_player() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.ranked_matches where id = p_game_id) then
    if exists (select 1 from public.ranked_matches where id = p_game_id and created_by = auth.uid()) then
      return public.ranked_deltas(p_game_id);
    end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) <> 2 then
    raise exception 'INVALID_RANKED_GAME' using errcode = 'P0001';
  end if;
  v_first := p_players -> 0;
  v_second := p_players -> 1;
  if not (v_first ? 'profile_id' and v_second ? 'profile_id') then
    raise exception 'INVALID_RANKED_GAME' using errcode = 'P0001';
  end if;
  if (v_first ->> 'rank')::integer = 1 and (v_first ->> 'remaining')::integer = 0 then
    v_winner := v_first; v_loser := v_second;
  elsif (v_second ->> 'rank')::integer = 1 and (v_second ->> 'remaining')::integer = 0 then
    v_winner := v_second; v_loser := v_first;
  else
    raise exception 'INVALID_RANKED_GAME' using errcode = 'P0001';
  end if;
  if (v_loser ->> 'remaining')::integer not between 1 and 301 or (v_loser ->> 'rank')::integer <> 2 then
    raise exception 'INVALID_RANKED_GAME' using errcode = 'P0001';
  end if;

  -- Le joueur qui tient le compteur est « domicile » (l'admin : le 1er dans l'ordre de jeu).
  if (v_second ->> 'profile_id')::uuid = auth.uid() then
    v_first := p_players -> 1;
    v_second := p_players -> 0;
  end if;
  v_result := public.record_ranked_match(
    p_game_id, 'darts', (v_first ->> 'profile_id')::uuid, (v_second ->> 'profile_id')::uuid,
    jsonb_build_object(
      'winner', case when v_winner ->> 'profile_id' = v_first ->> 'profile_id' then 'home' else 'away' end,
      'loser_remaining', (v_loser ->> 'remaining')::integer));
  -- La partie rejoint l'historique du compteur, liée au match classé.
  perform public.record_dart_game(p_game_id, 301::smallint, false, 'finished', p_started_at, p_players);
  update public.ranked_matches set dart_game_id = p_game_id where id = p_game_id;
  return v_result;
end;
$$;

revoke all on function public.ranked_notify(uuid) from public, anon, authenticated;
revoke all on function public.ranked_player_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.ranked_score(public.discipline, jsonb) from public, anon, authenticated;
revoke all on function public.ranked_deltas(uuid) from public, anon, authenticated;
revoke all on function public.check_ranked_rights(uuid) from public, anon, authenticated;
revoke all on function public.record_ranked_match(uuid, public.discipline, uuid, uuid, jsonb) from public, anon;
revoke all on function public.correct_ranked_match(uuid, jsonb) from public, anon;
revoke all on function public.delete_ranked_match(uuid) from public, anon;
revoke all on function public.record_ranked_dart_game(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.record_ranked_match(uuid, public.discipline, uuid, uuid, jsonb) to authenticated;
grant execute on function public.correct_ranked_match(uuid, jsonb) to authenticated;
grant execute on function public.delete_ranked_match(uuid) to authenticated;
grant execute on function public.record_ranked_dart_game(uuid, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Temps réel : matchs classés (RLS appliquée aux événements)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime absente : temps réel non activé.';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ranked_matches'
  ) then
    alter publication supabase_realtime add table public.ranked_matches;
  end if;
end;
$$;
