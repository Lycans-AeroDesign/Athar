# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is Athar (أثر), an open-source, self-hosted Knowledge Management System for student AeroDesign teams — see [`README.md`](README.md) for the product pitch and [`docs/VISION.md`](docs/VISION.md) for the full spec/roadmap. Authentication, RBAC, organization settings, i18n, the Knowledge module (articles, Q&A, categories/tags, attachments, cross-linking, search, activity feed, invitation-code registration), the engineering domain (projects, components with workshop inventory and CSV sync, failures, SOPs, tests, documents), bookmarks, collections, public share links, article revision compare/restore, a 30-day trash (soft delete + restore), the Training Center, policy acceptance (terms/privacy versions), org backups, and a platform-admin area (platform settings, server + browser error log) are built and have real test coverage. Backend and frontend are fully integrated — verify current behavior against the actual code/tests rather than assuming a feature is a stub.

**Primary dev workflow is Docker Compose** (`docker compose up` — see the [README Quickstart](README.md#quickstart-docker)); the bare `uv run`/`npm run dev` commands below work standalone too, but most day-to-day work in this repo happens against the running containers (`docker compose exec backend ...`, `docker compose restart frontend`, etc.).

For contribution conventions (commit format, migrations, i18n, permission gating, security rules) see [`CONTRIBUTING.md`](CONTRIBUTING.md) — don't duplicate that guidance here.

## Backend (`backend/`)

Django 6.1 project managed with `uv`, targeting Python 3.14 (pinned in `.python-version`). Apps: `core` (shared abstract model base classes, health check, whole-instance backup commands), `accounts` (auth, users, invitation codes), `rbac` (roles/permissions), `organization` (org settings/branding), `knowledge` (articles, Q&A, categories, tags, relations, attachments, search, and the engineering domain incl. component inventory), `training` (courses, lessons, enrollment, progress), `files` (generic auth-gated file storage), `audit` (action log), `backups` (org-scoped backup/restore via Celery), `policies` (versioned terms/privacy policies and per-user acceptance), `platform_admin` (instance-wide platform settings and the error log). New models use `core`'s base classes — see `CONTRIBUTING.md` §3.4.

Commands (run from `backend/`, or prefix with `docker compose exec backend` to run inside the container):
```bash
uv sync                          # install/sync dependencies into .venv
uv run manage.py runserver       # start dev server
uv run manage.py migrate         # apply migrations
uv run manage.py makemigrations  # create migrations after model changes
uv run manage.py startapp <name> # scaffold a new app
uv run manage.py test --parallel auto  # run the test suite (one DB clone per core; ~2.7x faster than serial)
uv run manage.py test <app>            # run one app's tests
uv run manage.py seed_rbac       # (re)seed the permission/role catalogue
uv run manage.py seed_test_users # create one login per role (see rbac/management/commands/seed_test_users.py)
uvx ruff@0.14.0 check --fix . && uvx ruff@0.14.0 format .  # lint + import order + formatting (CI checks both)
```

- Settings: `backend/config/settings.py`, loaded via `django-environ` from `backend/.env` (copy from `backend/.env.example`; `docker compose`/CI inject real env vars directly). `SECRET_KEY` is a placeholder dev key — must be replaced via env var before any production use.
- Database: **PostgreSQL only, no SQLite fallback** — `DATABASE_URL` is required in every environment, dev included (raises `ImproperlyConfigured` if unset).
- Every API view uses `drf_spectacular`'s `@extend_schema`; endpoints live under `/api/v1/...`. The interactive schema/Swagger UI is only mounted when `DEBUG=True`.
- Auth is JWT access token (Bearer header, held in-memory client-side) + an httpOnly refresh cookie — there is **no session-cookie fallback** for API auth. This matters for anything serving files/images: a plain `<img src>` or direct browser navigation can't attach the Bearer header, so protected binary content (see `files/views.py`) is fetched via JS (`apiFetch` → blob → object URL) rather than linked directly — see `frontend/components/ui/AuthenticatedImage.tsx`.

## Frontend (`frontend/`)

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4. Uses the React Compiler (`babel-plugin-react-compiler`). Fully i18n-routed via `next-intl` — every route lives under `app/[locale]/...` (`/en/...`, `/ar/...`); there's no bare `app/page.tsx`. `app/[locale]/(protected)/` holds authenticated routes (dashboard, `knowledge/`, `projects/`, `components/`, `failures/`, `sops/`, `tests/`, `documents/`, `training/`, `bookmarks/`, `collections/`, `trash/`, `users/`, `policies/`, `platform/`, `settings/`, `account/`, `help/`, `about/`); `login/`, `register/`, `forgot-password/`, `reset-password/` and `s/` (public share-link pages) are public.

Commands (run from `frontend/`, or prefix with `docker compose exec frontend`):
```bash
npm run dev     # start dev server (Turbopack) at http://localhost:3000
npm run build   # production build (also the real type-check - run before merging)
npm run start   # serve production build
npm run lint    # eslint
npm test        # vitest unit tests (*.test.ts / *.test.tsx next to the code)
npm run format  # prettier, incl. import order (CI runs format:check)
```

- Root layout: `frontend/app/[locale]/layout.tsx`; global styles: `frontend/app/[locale]/globals.css`.
- **Reuse before you build.** UI primitives live in `frontend/components/ui/`; feature components live in `frontend/components/<feature>/`; shared hooks/helpers live in `frontend/lib/`. Before writing a new component, hook, or helper, `ls`/grep those folders for one that already does the job (or nearly does — extend it with a prop rather than forking a copy). Create a new one only when nothing existing fits, and put it in `components/ui/` if it's generic. See `CONTRIBUTING.md` §4.5. The ones most often reinvented by mistake:
  - Dropdowns/selects → `Combobox` (used for every option picker, including short filter lists). Don't use a native `<select>`.
  - Action/overflow menus → `Menu`. Toggles → `Switch`. Dates → `DatePicker`. Tags → `TagInput`.
  - Popups → `Modal` (fixed header/footer, scrolling body) or `ConfirmModal` for yes/no; file/image viewing → `FilePreviewModal`, `ImageLightbox`, `PdfViewer`.
  - The big title/name field at the top of a create/edit form → `TitleInput` (pass `autoFocus` on create forms).
  - Text fields → `FloatingLabelInput` or `INPUT_CLASS` from `inputStyles.ts`; buttons → `Button`/`IconButton`; icons → `Icon`.
  - Lists/tables → `DataTable`, `Pagination`, `EmptyState`, `Skeleton`, `LoadError`, `ActiveFilterChip`, `ViewModeToggle`.
  - Uploads → `FileDropzone`/`PhotoDropzone`; markdown → `Markdown`/`MarkdownEditor`; protected images → `AuthenticatedImage`.
- Scrollbars are styled globally in `globals.css` (thin, rounded, transparent track) for every inner scroll region; don't add per-component scrollbar CSS.
- API calls are centralized in `frontend/lib/api/*.ts` (typed functions over `apiJson`/`apiFetch`/`apiVoid` from `lib/api/client.ts`), not scattered `fetch` calls in components.
- **Turbopack's dev-server hot reload doesn't reliably pick up every change** — provider/context edits and some new root-level components in particular can silently not apply. If a change doesn't seem to take effect, `docker compose restart frontend` before assuming the code is wrong.

## Working across the monorepo

Backend and frontend are fully integrated: the frontend's `NEXT_PUBLIC_API_URL` points at the Django API, and most features touch both sides (a new endpoint typically needs a matching `lib/api/*.ts` function, i18n keys in both `en.json`/`ar.json`, and RBAC permission wiring in `rbac/management/commands/seed_rbac.py` if it's gated). When changing an endpoint's shape, grep the frontend for its `lib/api/` wrapper and update both together rather than assuming one side is independent of the other.
