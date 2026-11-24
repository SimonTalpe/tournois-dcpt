-- =====================================================================
-- Format « Qualification puis élimination directe » (décision de Sim du 24/11/2026)
--
-- - Phase de qualification : V victoires pour se qualifier, D défaites pour être éliminé
--   (par défaut 1 et 2 : round 1 puis repêchage). Un joueur joue toujours contre un joueur
--   de même bilan (victoires, défaites), tiré au sort en évitant les revanches.
-- - Round 1 tiré par le site au lancement. Les matchs suivants sont créés par la base
--   (qualification_progress), selon le réglage du tournoi :
--   au fil de l'eau / à la fin de chaque round / par l'admin.
-- - Nombre impair dans un bilan : un exempt (victoire sans points), quand plus aucun joueur
--   ne peut encore arriver à ce bilan. L'admin peut changer l'exempté.
-- - Correction ou effacement d'un résultat : les matchs suivants (non joués) des deux joueurs
--   sont supprimés puis recréés ; refusé si l'un d'eux a déjà joué un match suivant.
-- - Phase finale : calculée par le site (classement des qualifiés) puis enregistrée par l'admin
--   (admin_generate_qualification_final). Les résultats de qualification sont alors figés.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Réglages du tournoi
-- ---------------------------------------------------------------------
alter table public.tournaments
  add column qualification_wins smallint check (qualification_wins between 1 and 3),
  add column qualification_losses smallint check (qualification_losses between 1 and 3),
  add column qualification_pairing public.qualification_pairing,
  add column qualification_next_stage public.qualification_next_stage,
  -- Parties à plusieurs (étape « groups ») : taille et qualifiés par partie
  add column group_size smallint check (group_size between 3 and 4),
  add column group_qualifiers smallint check (group_qualifiers between 1 and 3);

-- Comparaisons en texte : les nouvelles valeurs d'énumération ne peuvent pas encore servir ici.
alter table public.tournaments drop constraint tournaments_pool_options;
alter table public.tournaments add constraint tournaments_pool_options check (
  (format::text <> 'pools_knockout' and pool_count is null and qualifiers_per_pool is null)
  or (format::text = 'pools_knockout' and pool_count is not null and qualifiers_per_pool is not null)
);
alter table public.tournaments add constraint tournaments_qualification_options check (
  (format::text = 'qualification_knockout') = (
    qualification_wins is not null and qualification_losses is not null
    and qualification_pairing is not null and qualification_next_stage is not null
  )
);
alter table public.tournaments add constraint tournaments_group_options check (
  (qualification_next_stage::text is distinct from 'groups' and group_size is null and group_qualifiers is null)
  or (qualification_next_stage::text = 'groups' and group_size is not null and group_qualifiers is not null
      and group_qualifiers < group_size)
);
-- Pas de consolante dans ce format (décision du 24/11).
alter table public.tournaments add constraint tournaments_qualification_no_consolation check (
  format::text <> 'qualification_knockout' or not consolation
);

grant insert (qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage,
  group_size, group_qualifiers) on public.tournaments to authenticated;
grant update (qualification_wins, qualification_losses, qualification_pairing, qualification_next_stage,
  group_size, group_qualifiers) on public.tournaments to authenticated;

-- Structure figée après lancement : les réglages de qualification aussi.
create or replace function public.tournaments_guard_config()
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
    or new.qualification_wins is distinct from old.qualification_wins
    or new.qualification_losses is distinct from old.qualification_losses
    or new.qualification_pairing is distinct from old.qualification_pairing
    or new.qualification_next_stage is distinct from old.qualification_next_stage
    or new.group_size is distinct from old.group_size
    or new.group_qualifiers is distinct from old.group_qualifiers
  ) then
    raise exception 'CONFIG_LOCKED' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Phase finale : tours du tableau (et non plus « tout tour hors poules », pour la qualification)
-- ---------------------------------------------------------------------
create or replace function public.has_final_phase(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tournament_rounds r
    where r.tournament_id = p_tournament_id and r.bracket in ('main', 'third_place', 'consolation')
  );
$$;

-- Résultat figé : match de poule ou de qualification une fois la phase finale générée.
create function public.match_is_frozen(p_match public.matches)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_final_phase(p_match.tournament_id) and (
    p_match.pool_id is not null
    or exists (
      select 1 from public.tournament_rounds r
      where r.id = p_match.round_id and r.bracket::text = 'qualification'
    )
  );
$$;

-- Reprise de check_result_rights (départages / phase finale) avec le gel des matchs de qualification.
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
  if public.match_is_frozen(v_match) then
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

-- Reprise de check_admin_match_action (forfaits) avec le gel des matchs de qualification.
create or replace function public.check_admin_match_action(p_match_id uuid)
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
  if public.match_is_frozen(v_match) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  return v_match;
end;
$$;

-- Annulation de la phase finale : seuls les tours du tableau sont supprimés (poules et qualification restent).
create or replace function public.admin_reset_final_phase(p_tournament_id uuid)
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
    where m.tournament_id = p_tournament_id and r.bracket in ('main', 'third_place', 'consolation')
      and m.status in ('played', 'walkover', 'cancelled')
  ) then
    raise exception 'TOURNAMENT_HAS_RESULTS' using errcode = 'P0001';
  end if;
  delete from public.matches m using public.tournament_rounds r
  where r.id = m.round_id and m.tournament_id = p_tournament_id and r.bracket in ('main', 'third_place', 'consolation');
  delete from public.tournament_rounds
  where tournament_id = p_tournament_id and bracket in ('main', 'third_place', 'consolation');
end;
$$;

-- ---------------------------------------------------------------------
-- Bilans de qualification
-- ---------------------------------------------------------------------
-- Par inscrit : victoires (exempts et forfaits compris), défaites, match en cours.
create function public.qualification_records(p_tournament_id uuid)
returns table (player_id uuid, wins integer, losses integer, busy boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select m.home_player_id, m.away_player_id, m.winner_player_id, m.status
    from public.matches m
    join public.tournament_rounds r on r.id = m.round_id
    where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification'
  )
  select e.player_id,
    (select count(*) from q where q.winner_player_id = e.player_id and q.status in ('played', 'walkover', 'bye'))::integer,
    (select count(*) from q
     where q.status in ('played', 'walkover') and e.player_id in (q.home_player_id, q.away_player_id)
       and q.winner_player_id is distinct from e.player_id)::integer,
    exists (select 1 from q where q.status = 'pending' and e.player_id in (q.home_player_id, q.away_player_id))
  from public.tournament_entries e
  where e.tournament_id = p_tournament_id;
$$;

-- Crée un match (ou un exempt si p_away est null) au round suivant du bilan des joueurs.
create function public.qualification_create_match(p_tournament_id uuid, p_round_number integer, p_home uuid, p_away uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_position integer;
begin
  select r.id into v_round_id
  from public.tournament_rounds r
  where r.tournament_id = p_tournament_id and r.bracket::text = 'qualification' and r.round_number = p_round_number;
  if v_round_id is null then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = format('round de qualification %s', p_round_number);
  end if;
  select coalesce(max(m.position), 0) + 1 into v_position from public.matches m where m.round_id = v_round_id;
  insert into public.matches (tournament_id, round_id, position, plan_key,
    home_player_id, away_player_id, winner_player_id, status)
  values (p_tournament_id, v_round_id, v_position, format('qualification-%s-%s', p_round_number, v_position),
    p_home, p_away,
    case when p_away is null then p_home end,
    (case when p_away is null then 'bye' else 'pending' end)::public.match_status);
end;
$$;

-- Apparie les joueurs en attente d'un même bilan (ordre déjà tiré au sort), en évitant les revanches.
-- Reste un joueur : exempt si p_allow_bye. Renvoie le nombre de matchs (et exempts) créés.
create function public.qualification_pair_bucket(
  p_tournament_id uuid, p_wins integer, p_losses integer, p_waiting uuid[], p_allow_bye boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_remaining uuid[] := p_waiting;
  v_first uuid;
  v_other uuid;
  v_candidate uuid;
  v_created integer := 0;
begin
  while cardinality(v_remaining) >= 2 loop
    v_first := v_remaining[1];
    v_other := null;
    foreach v_candidate in array v_remaining[2:] loop
      if not exists (
        select 1 from public.matches m
        join public.tournament_rounds r on r.id = m.round_id
        where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification'
          and ((m.home_player_id = v_first and m.away_player_id = v_candidate)
            or (m.home_player_id = v_candidate and m.away_player_id = v_first))
      ) then
        v_other := v_candidate;
        exit;
      end if;
    end loop;
    v_other := coalesce(v_other, v_remaining[2]);
    perform public.qualification_create_match(p_tournament_id, p_wins + p_losses + 1, v_first, v_other);
    v_remaining := array_remove(array_remove(v_remaining, v_first), v_other);
    v_created := v_created + 1;
  end loop;
  if cardinality(v_remaining) = 1 and p_allow_bye then
    perform public.qualification_create_match(p_tournament_id, p_wins + p_losses + 1, v_remaining[1], null);
    v_created := v_created + 1;
  end if;
  return v_created;
end;
$$;

-- Crée les matchs de qualification possibles. p_force : demande de l'admin (mode « par l'admin »),
-- qui exige un round terminé et lève une erreur explicite sinon. Renvoie le nombre de matchs créés.
create function public.qualification_progress(p_tournament_id uuid, p_force boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_mode text;
  v_bucket record;
  v_closed boolean;
  v_created integer := 0;
  v_step integer;
  v_level integer;
  v_guard integer := 0;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.format::text <> 'qualification_knockout' then
    return 0;
  end if;
  if v_t.status <> 'in_progress' then
    if p_force then raise exception 'NOT_IN_PROGRESS' using errcode = 'P0001'; end if;
    return 0;
  end if;
  if public.has_final_phase(p_tournament_id) then
    if p_force then raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001'; end if;
    return 0;
  end if;
  v_mode := v_t.qualification_pairing::text;
  if v_mode = 'manual' and not p_force then
    return 0;
  end if;

  loop
    v_guard := v_guard + 1;
    if v_guard > 50 then
      raise exception 'QUALIFICATION_LOOP' using errcode = 'P0001';
    end if;

    -- Par round (fin de round / admin) : seulement le niveau le moins avancé (nombre de matchs joués),
    -- et seulement quand tous ses joueurs ont fini leur match.
    v_level := null;
    if v_mode in ('end_of_round', 'manual') then
      select min(q.wins + q.losses) into v_level
      from public.qualification_records(p_tournament_id) q
      where q.wins < v_t.qualification_wins and q.losses < v_t.qualification_losses;
      exit when v_level is null;
      if exists (
        select 1 from public.qualification_records(p_tournament_id) q
        where q.wins < v_t.qualification_wins and q.losses < v_t.qualification_losses
          and q.wins + q.losses = v_level and q.busy
      ) then
        if p_force and v_created = 0 then
          raise exception 'ROUND_NOT_FINISHED' using errcode = 'P0001';
        end if;
        exit;
      end if;
    end if;

    v_step := 0;
    for v_bucket in
      select q.wins, q.losses, array_agg(q.player_id order by random()) as waiting
      from public.qualification_records(p_tournament_id) q
      where q.wins < v_t.qualification_wins and q.losses < v_t.qualification_losses and not q.busy
        and (v_level is null or q.wins + q.losses = v_level)
      group by q.wins, q.losses
      order by q.wins + q.losses, q.wins desc
    loop
      -- Bilan « fermé » : plus aucun joueur en lice ne peut encore y arriver (exempt possible).
      v_closed := not exists (
        select 1 from public.qualification_records(p_tournament_id) o
        where o.wins < v_t.qualification_wins and o.losses < v_t.qualification_losses
          and o.wins <= v_bucket.wins and o.losses <= v_bucket.losses
          and not (o.wins = v_bucket.wins and o.losses = v_bucket.losses)
      );
      v_step := v_step + public.qualification_pair_bucket(
        p_tournament_id, v_bucket.wins, v_bucket.losses, v_bucket.waiting, v_closed);
    end loop;
    exit when v_step = 0;
    v_created := v_created + v_step;
  end loop;

  if p_force and v_created = 0 then
    raise exception 'NOTHING_TO_PAIR' using errcode = 'P0001';
  end if;
  return v_created;
end;
$$;

-- Bilan d'un joueur avant un round de qualification (victoires, exempts compris ; défaites).
create function public.qualification_record_before(p_tournament_id uuid, p_player_id uuid, p_round_number integer)
returns table (wins integer, losses integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where m.winner_player_id = p_player_id and m.status in ('played', 'walkover', 'bye'))::integer,
    count(*) filter (where m.status in ('played', 'walkover') and m.winner_player_id is distinct from p_player_id)::integer
  from public.matches m
  join public.tournament_rounds r on r.id = m.round_id
  where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification' and r.round_number < p_round_number
    and p_player_id in (m.home_player_id, m.away_player_id);
$$;

-- Supprime les matchs de qualification suivants (non joués) de ces joueurs ; refusé si l'un est joué.
-- Résultat retiré (effacement, forfait rétabli) : ces joueurs reviennent à leur bilan d'avant le match,
-- et les bilans qu'ils peuvent encore atteindre ne sont plus « fermés » : les exempts déjà donnés dans ces
-- bilans sont retirés aussi (puis redonnés par qualification_progress), refusé si l'exempté a joué depuis.
create function public.qualification_invalidate_after(
  p_tournament_id uuid, p_round_number integer, p_players uuid[], p_result_removed boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_players uuid[] := p_players;
  v_wins integer;
  v_losses integer;
begin
  if p_result_removed and cardinality(p_players) > 0 then
    select b.wins, b.losses into v_wins, v_losses
    from public.qualification_record_before(p_tournament_id, p_players[1], p_round_number) b;
    select v_players || coalesce(array_agg(m.home_player_id), '{}') into v_players
    from public.matches m
    join public.tournament_rounds r on r.id = m.round_id
    cross join lateral public.qualification_record_before(p_tournament_id, m.home_player_id, r.round_number) b
    where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification' and r.round_number > p_round_number
      and m.status = 'bye' and b.wins >= v_wins and b.losses >= v_losses;
  end if;
  if exists (
    select 1 from public.matches m join public.tournament_rounds r on r.id = m.round_id
    where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification' and r.round_number > p_round_number
      and m.status in ('played', 'walkover')
      and (m.home_player_id = any (v_players) or m.away_player_id = any (v_players))
  ) then
    raise exception 'NEXT_MATCH_PLAYED' using errcode = 'P0001';
  end if;
  delete from public.matches m
  using public.tournament_rounds r
  where r.id = m.round_id and m.tournament_id = p_tournament_id and r.bracket::text = 'qualification'
    and r.round_number > p_round_number
    and (m.home_player_id = any (v_players) or m.away_player_id = any (v_players));
end;
$$;

-- Après chaque résultat de qualification (saisie, correction, effacement, forfait, exempt modifié).
create function public.qualification_after_match_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bracket text;
  v_round integer;
begin
  select r.bracket::text, r.round_number into v_bracket, v_round
  from public.tournament_rounds r where r.id = new.round_id;
  if v_bracket is distinct from 'qualification' or public.has_final_phase(new.tournament_id) then
    return null;
  end if;
  if old.status in ('played', 'walkover', 'bye') and (
    new.status not in ('played', 'walkover', 'bye') or new.winner_player_id is distinct from old.winner_player_id
  ) then
    perform public.qualification_invalidate_after(new.tournament_id, v_round,
      array_remove(array[old.home_player_id, old.away_player_id], null),
      new.status not in ('played', 'walkover', 'bye'));
  end if;
  perform public.qualification_progress(new.tournament_id, false);
  return null;
end;
$$;

create trigger matches_qualification_progress
  after update of status, winner_player_id on public.matches
  for each row
  when (old.status is distinct from new.status or old.winner_player_id is distinct from new.winner_player_id)
  execute function public.qualification_after_match_update();

-- ---------------------------------------------------------------------
-- Actions de l'admin
-- ---------------------------------------------------------------------
-- Mode « par l'admin » (ou relance) : crée le round suivant quand le round en cours est terminé.
create function public.admin_qualification_next_round(p_tournament_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.qualification_progress(p_tournament_id, true);
end;
$$;

-- Change l'exempté d'un round : p_player_id (même bilan, match du même round pas encore joué)
-- prend l'exemption ; l'ancien exempté prend sa place dans ce match.
create function public.admin_swap_qualification_bye(p_match_id uuid, p_player_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bye public.matches;
  v_other public.matches;
  v_round integer;
  v_bye_player uuid;
  v_wins_a integer;
  v_losses_a integer;
  v_wins_b integer;
  v_losses_b integer;
begin
  v_bye := public.check_admin_match_action(p_match_id);
  select r.round_number into v_round from public.tournament_rounds r
  where r.id = v_bye.round_id and r.bracket::text = 'qualification';
  if v_round is null or v_bye.status <> 'bye' then
    raise exception 'NOT_A_BYE' using errcode = 'P0001';
  end if;
  v_bye_player := v_bye.home_player_id;
  if p_player_id = v_bye_player then
    return;
  end if;
  select m.* into v_other from public.matches m
  where m.round_id = v_bye.round_id and m.status = 'pending' and p_player_id in (m.home_player_id, m.away_player_id)
  for update;
  if not found then
    raise exception 'BYE_SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'match pas en attente';
  end if;
  -- L'ancien exempté ne doit pas avoir de match après son exemption.
  if exists (
    select 1 from public.matches m join public.tournament_rounds r on r.id = m.round_id
    where m.tournament_id = v_bye.tournament_id and r.bracket::text = 'qualification' and r.round_number > v_round
      and v_bye_player in (m.home_player_id, m.away_player_id)
  ) then
    raise exception 'BYE_SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'exempté déjà engagé plus loin';
  end if;
  -- Même bilan avant ce round (l'exempté a une victoire de plus, celle de l'exemption).
  select q.wins, q.losses into v_wins_a, v_losses_a from public.qualification_records(v_bye.tournament_id) q
  where q.player_id = v_bye_player;
  select q.wins, q.losses into v_wins_b, v_losses_b from public.qualification_records(v_bye.tournament_id) q
  where q.player_id = p_player_id;
  if v_wins_a - 1 <> v_wins_b or v_losses_a <> v_losses_b then
    raise exception 'BYE_SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'bilans différents';
  end if;

  update public.matches
  set home_player_id = case when home_player_id = p_player_id then v_bye_player else home_player_id end,
      away_player_id = case when away_player_id = p_player_id then v_bye_player else away_player_id end
  where id = v_other.id;
  update public.matches set home_player_id = p_player_id, winner_player_id = p_player_id where id = v_bye.id;
end;
$$;

-- Phase finale d'un tournoi avec qualification : plan calculé par le site (classement des qualifiés).
create function public.admin_generate_qualification_final(p_tournament_id uuid, p_plan jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_qualified uuid[];
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
  if v_t.format::text <> 'qualification_knockout' then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tournoi sans qualification';
  end if;
  if public.has_final_phase(p_tournament_id) then
    raise exception 'FINAL_PHASE_EXISTS' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.qualification_records(p_tournament_id) q
    where q.wins < v_t.qualification_wins and q.losses < v_t.qualification_losses
  ) then
    raise exception 'QUALIFICATION_NOT_FINISHED' using errcode = 'P0001';
  end if;

  if jsonb_array_length(coalesce(p_plan -> 'pools', '[]')) > 0
     or exists (select 1 from jsonb_array_elements(p_plan -> 'rounds') r where r ->> 'bracket' not in ('main', 'third_place')) then
    raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'tours';
  end if;
  select coalesce(array_agg(q.player_id order by q.player_id), '{}') into v_qualified
  from public.qualification_records(p_tournament_id) q where q.wins >= v_t.qualification_wins;
  select coalesce(array_agg(x order by x), '{}') into v_main_players
  from (
    select distinct s.x::uuid as x
    from jsonb_array_elements(p_plan -> 'matches') m,
         jsonb_array_elements(p_plan -> 'rounds') r,
         lateral (values (m ->> 'home'), (m ->> 'away')) s (x)
    where r ->> 'key' = m ->> 'roundKey' and r ->> 'bracket' = 'main' and (r ->> 'roundNumber')::int = 1
      and s.x is not null
  ) d;
  if v_main_players is distinct from v_qualified then
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
  where r.bracket in ('main', 'third_place');

  if (select count(*) from public.matches mm join public.tournament_rounds r on r.id = mm.round_id
      where mm.tournament_id = p_tournament_id and r.bracket in ('main', 'third_place'))
     <> jsonb_array_length(p_plan -> 'matches') then
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

-- ---------------------------------------------------------------------
-- Lancement : reprise de admin_launch_tournament avec le format à qualification
-- (round 1 tiré par le site ; tous les rounds de qualification créés d'avance).
-- ---------------------------------------------------------------------
create or replace function public.admin_launch_tournament(p_tournament_id uuid, p_plan jsonb)
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
  v_first_bracket text;
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
  if v_t.format::text = 'qualification_knockout' then
    if cardinality(v_entries) < 6 then
      raise exception 'QUALIFICATION_MIN_PLAYERS' using errcode = 'P0001';
    end if;
    if (select count(*) from jsonb_array_elements(p_plan -> 'rounds') r where r ->> 'bracket' = 'qualification')
       <> v_t.qualification_wins + v_t.qualification_losses - 1
       or exists (select 1 from jsonb_array_elements(p_plan -> 'rounds') r where r ->> 'bracket' <> 'qualification') then
      raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'rounds de qualification';
    end if;
  end if;

  -- Chaque inscrit doit apparaître exactement une fois au départ du tirage :
  -- dans une poule, au 1er round de qualification, ou au 1er tour du tableau principal.
  if v_t.format = 'pools_knockout' then
    if jsonb_array_length(coalesce(p_plan -> 'pools', '[]')) <> v_t.pool_count then
      raise exception 'INVALID_PLAN' using errcode = 'P0001', detail = 'nombre de poules';
    end if;
    select coalesce(array_agg(x::uuid order by x::uuid), '{}') into v_planned
    from jsonb_array_elements(p_plan -> 'pools') p, jsonb_array_elements_text(p -> 'playerIds') x;
  else
    v_first_bracket := case when v_t.format::text = 'qualification_knockout' then 'qualification' else 'main' end;
    select coalesce(array_agg(x::uuid order by x::uuid), '{}') into v_planned
    from jsonb_array_elements(p_plan -> 'matches') m,
         jsonb_array_elements(p_plan -> 'rounds') r,
         lateral (values (m ->> 'home'), (m ->> 'away')) s (x)
    where r ->> 'key' = m ->> 'roundKey'
      and r ->> 'bracket' = v_first_bracket
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

  -- Exempt du round 1 déjà connu : les rounds suivants peuvent commencer (selon le réglage).
  perform public.qualification_progress(p_tournament_id, false);
end;
$$;

-- ---------------------------------------------------------------------
-- Remplacement d'un joueur : pendant la qualification, seulement s'il n'a encore aucun résultat
-- (son bilan ne peut pas être transféré ; sinon, le déclarer forfait).
-- ---------------------------------------------------------------------
create or replace function public.admin_replace_player(p_tournament_id uuid, p_old_player_id uuid, p_new_player_id uuid)
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
  if not public.has_final_phase(p_tournament_id) and exists (
    select 1 from public.matches m join public.tournament_rounds r on r.id = m.round_id
    where m.tournament_id = p_tournament_id and r.bracket::text = 'qualification'
      and m.status in ('played', 'walkover', 'bye')
      and p_old_player_id in (m.home_player_id, m.away_player_id)
  ) then
    raise exception 'QUALIFICATION_REPLACE_LOCKED' using errcode = 'P0001';
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
    and p_old_player_id in (home_player_id, away_player_id)
    and (status = 'pending' or (status = 'bye' and not exists (
      select 1 from public.tournament_rounds r where r.id = round_id and r.bracket::text = 'qualification'
    )));
end;
$$;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
revoke all on function
  public.qualification_records(uuid),
  public.qualification_create_match(uuid, integer, uuid, uuid),
  public.qualification_pair_bucket(uuid, integer, integer, uuid[], boolean),
  public.qualification_progress(uuid, boolean),
  public.qualification_invalidate_after(uuid, integer, uuid[], boolean),
  public.qualification_record_before(uuid, uuid, integer),
  public.match_is_frozen(public.matches)
from public, anon, authenticated;

grant execute on function
  public.admin_qualification_next_round(uuid),
  public.admin_swap_qualification_bye(uuid, uuid),
  public.admin_generate_qualification_final(uuid, jsonb)
to authenticated;
