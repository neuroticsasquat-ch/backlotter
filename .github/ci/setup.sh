#!/usr/bin/env bash
# Run by the shared python.yml after install, before the checks: CI's mirror of `task db:init`,
# which CI never runs. Creates upmovies and upmovies_test. Only the databases are load-bearing:
# migrations/env.py and tests/conftest.py each create the app, catalog, news and ingest schemas
# and the extensions they need. The schemas and citext/pgcrypto are created here as well, as the
# retired test.yml did, so a fresh CI database has the same shape as the localdev one before
# either of those runs.
set -euo pipefail
export PGPASSWORD=root
psql=(psql -h localhost -U root -v ON_ERROR_STOP=1)
for db in upmovies upmovies_test; do
  "${psql[@]}" -d postgres -c "CREATE DATABASE $db;"
  "${psql[@]}" -d "$db" -c "
    CREATE SCHEMA IF NOT EXISTS app;
    CREATE SCHEMA IF NOT EXISTS catalog;
    CREATE SCHEMA IF NOT EXISTS news;
    CREATE SCHEMA IF NOT EXISTS ingest;
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;"
done
