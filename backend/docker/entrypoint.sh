#!/bin/bash
set -euo pipefail

APP_USER=appuser
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"

wait_postgres() {
  echo "Waiting for Postgres at ${DB_HOST}:${DB_PORT}..."
  while ! nc -z "${DB_HOST}" "${DB_PORT}"; do
    sleep 1
  done
  echo "Postgres is ready."
}

# Named volumes may contain root-owned files from older runs; ensure appuser can write.
fix_volume_permissions() {
  mkdir -p /app/staticfiles /app/media
  chown -R "${APP_USER}:${APP_USER}" /app/staticfiles /app/media
}

run_as_appuser() {
  runuser -u "${APP_USER}" -- "$@"
}

# Only wait on Postgres when DATABASE_URL actually points at it - the sqlite
# fallback (no DATABASE_URL set) has nothing to wait for.
case "${DATABASE_URL:-}" in
  postgres://* | postgresql://*)
    wait_postgres
    ;;
esac

fix_volume_permissions

echo "Applying migrations..."
run_as_appuser python manage.py migrate --noinput

echo "Collecting static files..."
run_as_appuser python manage.py collectstatic --noinput

if [ $# -gt 0 ]; then
  echo "Starting server with command: $*"
  exec runuser -u "${APP_USER}" -- "$@"
else
  echo "Starting Django development server..."
  exec runuser -u "${APP_USER}" -- python manage.py runserver 0.0.0.0:8000
fi
