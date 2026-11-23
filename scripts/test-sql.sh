#!/usr/bin/env bash
# Teste les migrations Supabase sur un PostgreSQL vierge (base créée puis supprimée).
# Connexion via les variables PG* standard (PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -euo pipefail
cd "$(dirname "$0")/.."

DB="mpf_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT

# Les rôles anon/authenticated sont globaux au serveur : on ne les crée qu'une fois.
"${PSQL[@]}" -d "$DB" -c "do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;"
sed '/^create role /d' supabase/tests/00_fake_supabase_auth.sql | "${PSQL[@]}" -d "$DB"
# Publication du temps réel (créée d'office, vide, par Supabase)
"${PSQL[@]}" -d "$DB" -c "create publication supabase_realtime;"

for f in supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

for f in supabase/tests/[0-9]*.test.sql; do
  echo "→ tests $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -d "$DB" -f "$f" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
done

# Simulation de bout en bout (tournois complets joués avec la logique du site), si les dépendances sont installées.
if [ -d node_modules/pg ]; then
  echo "→ simulation de tournois complets"
  node scripts/simulate-db.ts "$DB" "${SIMULATION_TOURNAMENTS:-80}" ${SIMULATION_SEED:-}
fi

# Concurrence de l'Elo et des matchs classés (clients en parallèle sur une base neuve).
if [ -d node_modules/pg ]; then
  echo "→ concurrence Elo / matchs classés"
  DB2="mpf_stress_$$"
  createdb "$DB2"
  trap 'dropdb --if-exists "$DB"; dropdb --if-exists "$DB2"' EXIT
  sed '/^create role /d' supabase/tests/00_fake_supabase_auth.sql | "${PSQL[@]}" -d "$DB2"
  "${PSQL[@]}" -d "$DB2" -c "create publication supabase_realtime;"
  for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB2" -f "$f" > /dev/null; done
  node scripts/stress-elo.ts "$DB2" "${STRESS_CLIENTS:-8}" "${STRESS_OPS:-100}"
fi
