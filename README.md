# Athar (أثر)

Open-source, self-hosted **Knowledge Management System** for student AeroDesign teams — built and self-hosted by [Lycans AeroDesign](https://github.com/Lycans-AeroDesign) as its reference deployment.

> **Status: early development.** Authentication, RBAC, organization settings, and i18n are built. The Knowledge module (articles, Q&A, categories/tags, attachments, cross-linking, search, activity feed, dashboard) is a working first slice. Engineering areas (projects, components, failures, SOPs) haven't started. See [Roadmap](#roadmap) below.

## Why

Student engineering teams accumulate a huge amount of knowledge — designs, failures, SOPs, flight history, decisions, lessons learned — that mostly lives in people's heads and disappears when they graduate. Athar exists so a new member can search the system and understand not just **what** the team does, but **why**.

> **athar** (أثر) `/ˈæ.θɑːr/` — _Arabic_: a trace, mark, or remnant left behind by something that has passed.

The name reflects that purpose — the system exists to preserve the trace a team's work and decisions leave behind, so that knowledge outlives the people who created it.

The full product specification (vision, feature areas, roles/permissions, roadmap) lives in [`docs/VISION.md`](docs/VISION.md). Three principles sit above everything else in it:

1. **Self-hosted and open source** — every organization deploys and owns its own instance and data; this is not a hosted SaaS product.
2. **Connected knowledge** — knowledge objects (articles, components, projects, failures, SOPs, flights, decisions...) link to each other so context is discoverable, not siloed.
3. **Backend-enforced authorization** — the frontend is never a security boundary; every API request is authorized server-side, regardless of client.

## Tech stack

| | Current | Planned (see [`docs/VISION.md` §32](docs/VISION.md#32-technology-stack)) |
|---|---|---|
| Backend | Django 6.1, Django REST Framework, `drf-spectacular` (OpenAPI), `uv`, Python 3.14 | — |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, a small custom Radix/cmdk-based UI kit (`frontend/components/ui/`) | shadcn/ui (evaluating vs. the current custom kit) |
| Database | PostgreSQL 18 (via Docker), no SQLite fallback | PostgreSQL full-text search for V1 (current search is a plain `icontains` query) |
| Background work | — | Redis + Celery |
| File storage | Local filesystem (dev) | S3-compatible / MinIO (prod) |
| Deployment | Docker, Docker Compose | — |
| CI/CD | GitHub Actions (backend + frontend CI, PR checks, manual release/publish) | — |
| Testing | Backend: DRF `APITestCase` suite (`backend/*/tests.py`), run via `manage.py test` | Frontend: Vitest/RTL, Playwright; backend: possibly migrate to pytest |

## Quickstart (Docker)

```bash
git clone https://github.com/Lycans-AeroDesign/Lycans_KMS.git
cd Lycans_KMS
python scripts/generate_env.py   # generates .env / backend/.env / frontend/.env with real secrets
docker compose up
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

For a production-shaped build (gunicorn, standalone Next.js server, no bind mounts):

```bash
docker compose -f docker-compose.prod.yml up --build
```

`docker-compose.prod.yml` requires `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `NEXT_PUBLIC_API_URL` to be set explicitly (no dev fallbacks).

## Manual setup (without Docker)

**Backend** (from `backend/`):

Requires a running Postgres instance and `DATABASE_URL` set in `backend/.env` (copy from `backend/.env.example`) - there is no SQLite fallback.

```bash
uv sync                          # install dependencies into .venv
uv run manage.py migrate         # apply migrations
uv run manage.py runserver       # start dev server
```

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev                      # start dev server (Turbopack) at http://localhost:3000
```

Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env` first (or run `python scripts/generate_env.py`).

## Project structure

```text
backend/            Django project (config/, manage.py, pyproject.toml)
frontend/            Next.js app (app/, package.json)
docker-compose.yml           dev stack (hot reload, Postgres)
docker-compose.prod.yml      prod-shaped stack (gunicorn, standalone Next.js)
scripts/generate_env.py      generates local .env files with real secrets
docs/VISION.md                full product specification
.github/                      CI, PR automation, issue/PR templates
```

## Internationalization

The frontend is fully translation-driven (`next-intl`) — no UI text is hardcoded, it all comes from `frontend/i18n/messages/<locale>.json`. Routes are locale-prefixed (`/en/...`, `/ar/...`).

**Supported languages:**

| Code | Language | Direction | Status |
|---|---|---|---|
| `en` | English | LTR | ✅ Fully supported (source language) |
| `ar` | العربية (Arabic) | RTL | ✅ Fully supported — `frontend/i18n/messages/ar.json` is kept in parallel with every key in `en.json`, genuinely translated (not a copy) |

A language only reaches "file exists" status once it's registered in `frontend/i18n/request.ts` (see below) *and* has a `messages/<code>.json` file — at that point it's selectable in Settings > General even before translation is complete, since next-intl has no per-key fallback. Update this table whenever a language's status changes.

**To add a new language:**

1. Add its code to `locales` in `frontend/i18n/request.ts`.
2. Give it a display name (`localeNames`) and text direction (`localeDirections`), also in `frontend/i18n/request.ts`.
3. Copy `frontend/i18n/messages/en.json` to `frontend/i18n/messages/<code>.json` and translate the values (keep the same keys).

The language picker in Settings > General is generated from `locales`/`localeNames`, so the new language appears there automatically once its message file exists.

## Roadmap

Condensed from [`docs/VISION.md` §41](docs/VISION.md#41-development-roadmap):

- **V0.1 — Foundation**: Django, PostgreSQL, Next.js, Docker, auth, RBAC, org configuration *(done)*
- **V0.2 — Knowledge**: wiki, articles, categories, tags, attachments, revisions, relationships *(in progress — articles, Q&A, categories/tags, attachments, revisions, and cross-linking all built; search is a plain query, not full-text)*
- **V0.3 — Engineering**: projects, components, failures, SOPs, flight logs, design decisions, lessons learned *(not started)*
- **V0.4 — Collaboration**: Q&A ✅, comments, notifications, reviews ✅, activity ✅
- **V0.5 — Search**: full-text search, filters ✅, related knowledge ✅, mention detection
- **V1.0 — Open source release**: production hardening, backups, self-hosting guide, versioned Docker images
- **V2+ — AI**: embeddings, vector search, permission-aware RAG assistant over the knowledge graph

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for commit conventions, backend/frontend conventions, and the PR checklist.

## License

TBD — a license will be finalized before the V1.0 open-source release.
