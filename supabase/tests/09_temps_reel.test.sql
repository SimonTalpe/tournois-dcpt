-- Tests de l'étape 4 : temps réel (tables publiées).

\set ON_ERROR_STOP on
begin;
select tests.assert(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('tournaments', 'tournament_entries', 'tournament_rounds', 'matches', 'pool_tiebreaks')) = 5,
  'tables des tournois publiées pour le temps réel');
select tests.assert(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and tablename in ('profiles', 'app_settings', 'allowed_emails')),
  'données sensibles (profils, réglages, adresses) non publiées');
rollback;
\echo '✅ Tous les tests SQL du temps réel sont passés'
