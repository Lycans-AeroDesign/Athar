# Athar (أثر)

Open-source, self-hosted **Knowledge Management System** for student AeroDesign teams — built and self-hosted by [Lycans AeroDesign](https://github.com/Lycans-AeroDesign) as its reference deployment.

> **Status: early development.** Authentication, RBAC, organization settings, and i18n are built. The Knowledge module (articles, Q&A, categories/tags, attachments, cross-linking, ranked full-text search, bookmarks, activity feed, dashboard) is a working first slice, and the engineering domain — projects, components, failures, SOPs, plus test/experiment records and a document/resource library — is built alongside it on the same relation/attachment/tag infrastructure. Every content type supports a public/restricted visibility model, where a restricted item's creator can grant access to specific individuals and organization admins always have access. The backend is also multi-tenant: every deployment can host one self-hosted organization (the default/primary use case) or several independent organizations with full data isolation, via either invitation-based joining or self-service org creation; organization admins can also block/unblock member accounts. A weighted contribution-scoring/leaderboard system (with monthly/yearly/lifetime standings) sits on top of all of it, and organization admins can export their own organization's data and files as a downloadable backup (see [Backups](#backups)). Users have profile pictures shown wherever they're credited system-wide, first-run users get a guided product tour of the app, and `manage.py seed_demo_content` can spin up a realistic demo organization for evaluation. See [Roadmap](#roadmap) below.

## Why

Student engineering teams accumulate a huge amount of knowledge — designs, failures, SOPs, flight history, decisions, lessons learned — that mostly lives in people's heads and disappears when they graduate. Athar exists so a new member can search the system and understand not just **what** the team does, but **why**.

> **athar** (أثر) `/ˈæ.θɑːr/` — _Arabic_: a trace, mark, or remnant left behind by something that has passed.

The name reflects that purpose — the system exists to preserve the trace a team's work and decisions leave behind, so that knowledge outlives the people who created it.

The full product specification (vision, feature areas, roles/permissions, roadmap) lives in [`docs/VISION.md`](docs/VISION.md). Three principles sit above everything else in it:

1. **Self-hosted-first, multi-tenant-capable** — a team can still clone/deploy their own fully independent instance and own their data outright, same as always; the backend is also genuinely multi-tenant now (an `Organization` model, every row scoped to it, self-service org creation alongside invite-based joining), so one deployment can serve several isolated organizations instead of exactly one. See [`docs/VISION.md` §2](docs/VISION.md#2-open-source-philosophy) for the fuller status note on this.
2. **Connected knowledge** — knowledge objects (articles, components, projects, failures, SOPs, tests, documents, decisions...) link to each other so context is discoverable, not siloed.
3. **Backend-enforced authorization** — the frontend is never a security boundary; every API request is authorized server-side, regardless of client.

## Tech stack

| | Current | Planned (see [`docs/VISION.md` §32](docs/VISION.md#32-technology-stack)) |
|---|---|---|
| Backend | Django 6.1, Django REST Framework, `drf-spectacular` (OpenAPI), `uv`, Python 3.14 | — |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, a small custom Radix/cmdk-based UI kit (`frontend/components/ui/`) | shadcn/ui (evaluating vs. the current custom kit) |
| Database | PostgreSQL 18 (via Docker), no SQLite fallback; search uses Postgres full-text search (`SearchVector`/`SearchRank`) with a trigram-similarity fallback for substring/typo matches, ranked by relevance | — |
| Background work | Redis + Celery (currently just the org-scoped backup export - see [Backups](#backups) below) | — |
| File storage | Local filesystem by default; set `AWS_STORAGE_BUCKET_NAME` to switch to any S3-compatible object storage instead (AWS S3, Cloudflare R2, Backblaze B2, self-hosted MinIO, ...) — see `backend/.env.example` | — |
| Deployment | Docker, Docker Compose, nginx reverse proxy (rate limiting, security headers, health check - see `nginx/nginx.conf`) | — |
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
- Nginx (reverse proxy in front of the backend only - see `nginx/nginx.conf`): http://localhost:80

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
nginx/nginx.conf              reverse proxy config (backend only - see the Quickstart section)
docker-compose.yml           dev stack (hot reload, Postgres, nginx)
docker-compose.prod.yml      prod-shaped stack (gunicorn, standalone Next.js, nginx)
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

## Backups

Two independent backup-and-restore paths, at two different scopes:

- **An organization's own data** (Settings > Backups, requires `organization.manage`) — exports that organization's own rows (users, knowledge/engineering content, files, audit log, ...) as a downloadable `.zip` (CSV per table, plus the actual uploaded files). Runs as a background Celery job so triggering it never ties up a request, however large the export - `docker compose up` already starts the `redis` and `celery-worker` services needed for this, no extra setup step. The same page can **restore** from any of that organization's own finished backups: a full wipe-and-replace of that organization's *content* (knowledge/engineering items, tags, categories, relations, restricted-access grants, bookmarks, attachments, and files) — original IDs are preserved, so cross-references between restored rows still line up. Deliberately scoped to content only: Users, Roles, and invitation codes are never touched, since a leaked backup must never be a credentials leak (`User.password` isn't in the export) and re-creating a User row from an archive raises correctness questions (merge? replace?) this app doesn't try to answer — an FK to a user who no longer exists in the organization is simply set to null and counted in the restore summary instead.
- **The whole instance** (every organization) — a real `pg_dump` of the entire database plus a tarball of the local media directory (skipped if file storage is S3-compatible - see the Tech stack table above), written to `backend/backup_archives/`. Deliberately CLI-only, not a web feature: `is_superuser` is break-glass/CLI-only everywhere else in this app, and Django admin itself isn't even registered outside `DEBUG` (see `backend/config/urls.py`), so there's no web-exposed "download/restore every organization's data" surface to get wrong. Restoring is a full wipe-and-replace of the *entire* database via `pg_restore --clean --if-exists`, gated behind an explicit `--yes` flag.

```bash
docker compose exec backend python manage.py create_full_backup
docker compose exec backend python manage.py restore_full_backup backup_archives/athar-db-<timestamp>.dump --media-archive-path backup_archives/athar-media-<timestamp>.tar.gz --yes
```

## Roadmap

Condensed from [`docs/VISION.md` §41](docs/VISION.md#41-development-roadmap):

- **V0.1 — Foundation**: Django, PostgreSQL, Next.js, Docker, auth, RBAC, org configuration *(done — plus multi-tenancy and an nginx reverse proxy, both added beyond the original scope of this milestone; see [`docs/VISION.md` §2](docs/VISION.md#2-open-source-philosophy))*
- **V0.2 — Knowledge**: wiki, articles, categories, tags, attachments, revisions, relationships *(in progress — articles, Q&A, categories/tags, attachments, revisions, cross-linking, bookmarks, and a per-item restricted-access grant system all built)*
- **V0.3 — Engineering**: projects, components, failures, SOPs, flight logs, design decisions, lessons learned *(partially in progress — projects, components, failures, and SOPs are built with full CRUD, tags/categories where applicable, attachments, cross-linking, and the same visibility/restricted-access model as Knowledge; test/experiment records and a document/resource library are also built, beyond this milestone's original list; Components additionally gained inventory tracking (on-hand quantity, photo, external link) plus a filtered CSV export; flight logs' relationship to the new test-record type is unresolved, see VISION §41; design decisions and lessons learned haven't started)*
- **V0.4 — Collaboration**: Q&A ✅, comments, notifications, reviews ✅, activity ✅, contribution scoring/leaderboard ✅ (This Month / This Year / Lifetime standings, each with its own rank)
- **V0.5 — Search**: full-text search ✅ (Postgres, ranked, with trigram fallback), filters ✅, related knowledge ✅, mention detection
- **V1.0 — Open source release**: production hardening, backups ✅ (org-scoped, in-app; whole-instance, CLI - see [Backups](#backups)), self-hosting guide, versioned Docker images
- **V2+ — AI**: embeddings, vector search, permission-aware RAG assistant over the knowledge graph

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for commit conventions, backend/frontend conventions, and the PR checklist.

## License

TBD — a license will be finalized before the V1.0 open-source release.
