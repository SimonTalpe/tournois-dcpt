-- Visibilité des participants (décision de Sim du 18/11/2026) :
-- joueurs et spectateurs ne voient que les participants d'un tournoi lancé
-- (inscrits, ou présents dans un match, ex. joueur remplacé après avoir joué).
-- L'admin voit tout ; chacun voit aussi son propre participant.

create function public.can_view_player(p_player_id uuid)
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
    );
$$;

grant execute on function public.can_view_player(uuid) to authenticated;

drop policy players_select on public.players;
create policy players_select on public.players
  for select to authenticated using (public.can_view_player(id));
