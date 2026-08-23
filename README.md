# AeroKMS

Open-source, self-hosted **Knowledge Management System** for student AeroDesign teams — built and self-hosted by [Lycans AeroDesign](https://github.com/Lycans-AeroDesign) as its reference deployment.

> **Status: early development.** This repo currently has the bootstrapped Django + Next.js foundation, Docker/CI scaffolding, and no product features yet. See [Roadmap](#roadmap) below.

## Why

Student engineering teams accumulate a huge amount of knowledge — designs, failures, SOPs, flight history, decisions, lessons learned — that mostly lives in people's heads and disappears when they graduate. AeroKMS exists so a new member can search the system and understand not just **what** the team does, but **why**.

The full product specification (vision, feature areas, roles/permissions, roadmap) lives in [`docs/VISION.md`](docs/VISION.md). Three principles sit above everything else in it:

1. **Self-hosted and open source** — every organization deploys and owns its own instance and data; this is not a hosted SaaS product.
2. **Connected knowledge** — knowledge objects (articles, components, projects, failures, SOPs, flights, decisions...) link to each other so context is discoverable, not siloed.
3. **Backend-enforced authorization** — the frontend is never a security boundary; every API request is authorized server-side, regardless of client.

## Tech stack

| | Current | Planned (see [`docs/VISION.md` §32](docs/VISION.md#32-technology-stack)) |
|---|---|---|
| Backend | Django 6.1, `uv`, Python 3.14 | + Django REST Framework, `drf-spectacular` (OpenAPI) |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 | + shadcn/ui |
| Database | PostgreSQL 18 (via Docker) | PostgreSQL full-text search for V1 |
| Background work | — | Redis + Celery |
| File storage | Local filesystem (dev) | S3-compatible / MinIO (prod) |
| Deployment | Docker, Docker Compose | — |
| CI/CD | GitHub Actions (backend + frontend CI, PR checks, manual release/publish) | — |
| Testing | — | pytest, Vitest/RTL, Playwright |

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

```bash
uv sync                          # install dependencies into .venv
uv run manage.py migrate         # apply migrations (uses SQLite unless DATABASE_URL is set)
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

## Roadmap

Condensed from [`docs/VISION.md` §41](docs/VISION.md#41-development-roadmap):

- **V0.1 — Foundation**: Django, PostgreSQL, Next.js, Docker, auth, RBAC, org configuration *(in progress)*
- **V0.2 — Knowledge**: wiki, articles, categories, tags, attachments, revisions, relationships
- **V0.3 — Engineering**: projects, components, failures, SOPs, flight logs, design decisions, lessons learned
- **V0.4 — Collaboration**: Q&A, comments, notifications, reviews, activity
- **V0.5 — Search**: full-text search, filters, related knowledge, mention detection
- **V1.0 — Open source release**: production hardening, backups, self-hosting guide, versioned Docker images
- **V2+ — AI**: embeddings, vector search, permission-aware RAG assistant over the knowledge graph

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for commit conventions, backend/frontend conventions, and the PR checklist.

## License

TBD — a license will be finalized before the V1.0 open-source release.
