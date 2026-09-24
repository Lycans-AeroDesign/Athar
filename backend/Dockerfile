# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.14

FROM python:${PYTHON_VERSION}-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
# Pinned, not :latest - this layer sits in the shared `base` stage, so every
# new uv release on a floating tag would change it and invalidate the build
# cache for everything after it (apt packages, deps, app) on the next CI run.
# Bump deliberately.
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /uvx /bin/
WORKDIR /app
# Debian's own "postgresql-client" package trails the Postgres release this
# app actually runs (postgres:18-alpine, see docker-compose.yml) - pg_dump
# refuses to dump from a server newer than itself, so `manage.py
# create_full_backup` needs a real v18 client. The PGDG apt repo is the
# standard way to get an exact-version match regardless of Debian's own
# packaged version.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 netcat-openbsd curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# ---- shared dependency layer (needs build tools to compile psycopg) ----
FROM base AS deps
# Cache mount, not a layer - persists uv/apt's downloaded packages across
# builds independent of layer invalidation, so editing pyproject.toml/
# uv.lock doesn't force every wheel to be re-downloaded from scratch.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# ---- dev: runserver + full dependency set, source mounted at runtime ----
FROM deps AS dev
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---- builder: prod dependency set + source, no dev tooling in final image ----
FROM deps AS builder
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ---- prod: gunicorn behind whitenoise-served static files ----
# Runs as root at container start (entrypoint needs it to fix volume
# permissions and wait on Postgres); the entrypoint drops to appuser via
# runuser before running migrate/collectstatic/the app itself.
FROM base AS prod
COPY --from=builder /app /app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
