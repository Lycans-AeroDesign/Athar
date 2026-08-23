# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.14

FROM python:${PYTHON_VERSION}-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# ---- shared dependency layer (needs build tools to compile psycopg) ----
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# ---- dev: runserver + full dependency set, source mounted at runtime ----
FROM deps AS dev
COPY . .
RUN uv sync --frozen
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---- builder: prod dependency set + source, no dev tooling in final image ----
FROM deps AS builder
COPY . .
RUN uv sync --frozen --no-dev

# ---- prod: gunicorn behind whitenoise-served static files ----
# Runs as root at container start (entrypoint needs it to fix volume
# permissions and wait on Postgres); the entrypoint drops to appuser via
# runuser before running migrate/collectstatic/the app itself.
FROM base AS prod
COPY --from=builder /app /app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
