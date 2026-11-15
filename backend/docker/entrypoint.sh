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

# Matches django-environ's truthy strings (settings.py: env.bool("DEBUG", default=True)).
is_debug() {
  case "${DEBUG:-True}" in
    [Tt]rue | 1 | [Yy]es | [Yy] | [Oo]n) return 0 ;;
    *) return 1 ;;
  esac
}

# Only wait on Postgres when DATABASE_URL actually points at it - the sqlite
# fallback (no DATABASE_URL set) has nothing to wait for.
case "${DATABASE_URL:-}" in
  postgres://* | postgresql://*)
    wait_postgres
    ;;
esac

fix_volume_permissions

# Only the web container runs the one-off setup. The Celery containers share
# this image and entrypoint but set RUN_MIGRATIONS=false - three containers
# migrating the same database at once raced each other - and instead wait for
# the backend's healthcheck, which passes once setup is done and it's serving.
case "${RUN_MIGRATIONS:-true}" in
  [Ff]alse | 0 | [Nn]o | [Nn] | [Oo]ff)
    echo "RUN_MIGRATIONS is off - skipping migrate/seed_rbac/collectstatic."
    ;;
  *)
    echo "Applying migrations..."
    run_as_appuser python manage.py migrate --noinput

    echo "Seeding default RBAC roles/permissions..."
    run_as_appuser python manage.py seed_rbac

    if is_debug; then
      echo "DEBUG is on - skipping collectstatic (WhiteNoise serves static files from source, see settings.py)."
    else
      echo "Collecting static files..."
      run_as_appuser python manage.py collectstatic --noinput
    fi
    ;;
esac

if [ $# -gt 0 ]; then
  echo "Starting server with command: $*"
  exec runuser -u "${APP_USER}" -- "$@"
else
  echo "Starting Django development server..."
  exec runuser -u "${APP_USER}" -- python manage.py runserver 0.0.0.0:8000
fi
