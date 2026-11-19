-- =====================================================================
-- Étape 4 — Temps réel
--
-- Les tables d'un tournoi sont publiées dans Supabase Realtime : les pages ouvertes
-- se mettent à jour seules (scores, avancement, horaires, départages, phase finale…).
-- Les règles de sécurité (RLS) s'appliquent aussi aux événements : chacun ne reçoit
-- que ce qu'il a le droit de lire.
-- =====================================================================

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime absente : temps réel non activé.';
    return;
  end if;
  foreach v_table in array array['tournaments', 'tournament_entries', 'tournament_rounds', 'matches', 'pool_tiebreaks'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
