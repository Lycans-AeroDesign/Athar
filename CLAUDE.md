# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repository is a freshly bootstrapped monorepo with two independent halves — `backend/` (Django) and `frontend/` (Next.js) — that do not yet talk to each other. There are no custom Django apps, no API endpoints, no frontend pages beyond the default scaffold, and no tests or CI configured yet. Do not assume architecture beyond what's described here; verify against current file contents before extending.

## Backend (`backend/`)

Django 6.1 project managed with `uv`, targeting Python 3.14 (pinned in `.python-version`).

Commands (run from `backend/`):
```bash
uv sync                          # install/sync dependencies into .venv
uv run manage.py runserver       # start dev server
uv run manage.py migrate         # apply migrations
uv run manage.py makemigrations  # create migrations after model changes
uv run manage.py startapp <name> # scaffold a new app
uv run manage.py test            # run tests (once apps/tests exist)
```

- Settings: `backend/config/settings.py`. `SECRET_KEY` is a placeholder dev key — must be replaced via env var before any production use. `DEBUG = True` and `ALLOWED_HOSTS = []` are dev defaults.
- Database: SQLite (`backend/db.sqlite3`), default `ENGINE`/`NAME` in `settings.py`.
- `INSTALLED_APPS` only contains Django's built-in apps — no project apps registered yet.
- `backend/.env.example.txt` documents expected environment variables — copy to `.env` for local secrets (not yet wired into `settings.py` via a loader).
- Dependency management is via `uv` (`pyproject.toml` + `uv.lock`), not pip/poetry — always use `uv add <pkg>` / `uv sync`, never edit `.venv` directly.

## Frontend (`frontend/`)

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4, created via `create-next-app`. Uses the React Compiler (`babel-plugin-react-compiler`).

Commands (run from `frontend/`):
```bash
npm run dev     # start dev server (Turbopack) at http://localhost:3000
npm run build   # production build
npm run start   # serve production build
npm run lint    # eslint
```

- Entry point: `frontend/app/page.tsx`; root layout: `frontend/app/layout.tsx`; global styles: `frontend/app/globals.css`.
- No test runner is configured yet.

## Working across the monorepo

Backend and frontend are developed and run independently (separate package managers, separate dev servers, no shared config or proxy yet). When adding integration between them (API routes, CORS, env-based API URLs), check both `backend/config/settings.py` and the frontend's fetch/config layer, since neither currently references the other.
