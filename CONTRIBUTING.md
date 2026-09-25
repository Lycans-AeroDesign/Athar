# Contributing to Athar

This document describes the rules and conventions to follow when developing in this project (`backend/` Django + `frontend/` Next.js). Please read and adhere to these guidelines before submitting changes.

Everything here reflects conventions already in active use (DRF views, migrations, i18n, permission gating, RBAC, the shared `core` model base classes, ...).

---

## 1. Development environment

See the [README Quickstart](README.md#quickstart-docker) for the full setup. Summary:

```bash
python scripts/generate_env.py   # generate local .env files with real secrets
docker compose up                # backend :8000, frontend :3000, Postgres
```

Without Docker: `uv sync && uv run manage.py runserver` (from `backend/`), `npm install && npm run dev` (from `frontend/`).

**Frontend hot reload isn't always reliable.** Turbopack's dev server can silently fail to pick up context/provider edits or new root-level components. If a frontend change doesn't seem to take effect, `docker compose restart frontend` before assuming the code is wrong.

---

## 2. Commit messages

Follow the [Angular commit message conventions](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md). This isn't just style — `pr-checks.yml` validates PR titles against this format, and the (currently manual) `release.yml` semantic-release workflow derives version bumps and changelogs from it.

### Format

```
<type>(<scope>): <short summary>
<blank line>
<body (optional, except for docs)>
<blank line>
<footer (optional)>
```

### Types

| Type         | Description                                              |
| ------------ | --------------------------------------------------------- |
| **feat**     | A new feature                                              |
| **fix**      | A bug fix                                                  |
| **docs**     | Documentation only changes                                 |
| **refactor** | Code change that neither fixes a bug nor adds a feature    |
| **perf**     | Performance improvement                                     |
| **test**     | Adding or correcting tests                                  |
| **build**    | Build system or dependency changes                          |
| **ci**       | CI configuration changes                                    |

### Rules

- Use **imperative, present tense**: "add" not "added" nor "adds"
- Do not capitalize the first letter of the summary
- No period at the end of the summary
- Scope is optional; use the affected area (e.g. `backend`, `frontend`, `docker`, or a Django app name — `accounts`, `knowledge`, `rbac`, `organization`, `files`, `audit`)

### Examples

- `feat(backend): add health check endpoint`
- `fix(frontend): correct nav link routing`
- `docs: update Docker setup instructions`

---

## 3. Backend conventions (Django)

### 3.1 API documentation (Swagger / OpenAPI)

- **Every** API view (`APIView`, `generics.*`, `ViewSet` actions) must be documented with `drf_spectacular`'s `@extend_schema` (or `@extend_schema_view` for ViewSets).
- Every `@extend_schema` must specify `tags` (e.g. `tags=["Projects"]`) so endpoints group cleanly in the interactive docs.
- Prefer plain `APIView`s over `ViewSet`s where practical — they make routing, allowed methods, and permissions explicit and readable.
- Document **all** possible responses: success (200/201/204) **and** errors (400/401/403/404/500) the endpoint can actually return.
- Define reusable `OpenApiResponse` objects for common error shapes (400/401/403/404/500) in one place — either per app or in a shared `core` app — and reference them from every view's `responses=` mapping instead of redefining them per view.
- When an endpoint can return different bodies under the same status code, document one schema for the shape and use `OpenApiExample` (with `response_only=True`) per variant.
- When a serializer's `validate()`/`validate_<field>()` raises `ValidationError` with specific messages, document those messages as `OpenApiExample`s on the endpoint's 400 response so API consumers see them without reading the serializer source.

**API versioning**: all endpoints live under a versioned prefix (`/api/v1/...`). Prefer adding a `v2` endpoint over changing `v1` behavior in place; keep `v1` backwards compatible until it's explicitly deprecated.

### 3.2 Migrations

- Run `manage.py makemigrations <app_name>` after changing models. One logical change per migration where possible.
- **Don't hand-write migrations for ordinary schema changes** (new/altered fields, models, indexes, constraints) — generate those with `makemigrations`. Hand-written migrations are only for what `makemigrations` can't express (data migrations, `RunPython`, one-off backfills).
- Never edit a migration that's already been applied anywhere. If you need to change the outcome, add a new migration.
- **Naming hand-written migrations**: `NNNN_manual_short_description_in_snake_case.py` — `NNNN` is the next sequential number in that app's `migrations/`, `manual` is a required marker so these are greppable (`grep -r "_manual_" --include="*.py" */migrations/`), and the description is short snake_case with a clear verb (`add_`, `remove_`, `populate_`, `backfill_`, `fix_`, `ensure_`).
  - Example: `0015_manual_populate_display_name_from_profile.py`
- Commit migration files together with the model changes that require them. Don't delete or rewrite migrations already applied in shared/production databases — use `squashmigrations` only by team agreement.
- CI runs `makemigrations --check --dry-run` — a PR with model changes but no matching migration will fail.
- **Keep data updates and schema changes on the same table in separate migrations.** Postgres refuses to alter a table that has pending row updates in the same transaction (`cannot ALTER TABLE ... because it has pending trigger events`), and each migration runs in one transaction. When a change needs both — e.g. moving a FK to a new model — split it: generated schema migration → `_manual_` data migration → schema migration. See `knowledge/migrations/0003`–`0005` (moving `Component.category` to `ComponentCategory`).

### 3.3 Utils and services

- **`<app>/utils.py`**: pure, stateless helpers with no DB access or cross-app orchestration (formatting, parsing, building a dict).
- **`<app>/services.py`**: business logic involving the database, multiple models, or cross-app coordination — operations too large for a single view/serializer. Views and serializers should call into services rather than embedding this logic inline.
- One `utils.py`/`services.py` per app by default; split by domain (`services/projects.py`, `services/failures.py`) if a file grows too large.

### 3.4 Model base classes (UUID primary keys + timestamps)

`backend/core/models.py` provides three abstract base classes — use them for every new model:

- **`UUIDPrimaryKeyModel`** — a UUID primary key. New models use UUID primary keys, not auto-incrementing integers — the knowledge graph's relationship model (§34 of `docs/VISION.md`) links objects across apps by ID, and UUIDs avoid cross-app ID collisions and make IDs safe to expose in URLs/APIs. Keys are **uuid7** (`uuid.uuid7`, Python 3.14 stdlib): time-ordered, so new rows append to the end of the primary-key index instead of scattering across it. Use `uuid.uuid7` for any hand-declared UUID key too — but keep `uuid.uuid4` where you need *randomness* (e.g. a short random suffix: a uuid7's leading hex digits are its timestamp).
- **`TimeStampedModel`** — `created_at`/`updated_at`. Use it for any model that needs them.
- **`OrganizationScopedModel`** — the `organization` FK. Use it for every tenant-owned model, but *not* for models only ever reached through an already-scoped parent (attachments, `Answer`, `ArticleRevision`, ...) — a redundant FK there is a sync risk, not extra isolation.
- Don't declare `id` manually on new models without a reviewed exception. Older models (most of `knowledge`, `accounts`, `rbac`) predate `core` and hand-roll the same fields in the same shape; they aren't being retrofitted, but new models shouldn't copy that.

### 3.5 Reuse existing code

- Search `utils.py`/`services.py` (this app and others) before writing a new helper — don't duplicate logic that already exists.
- Reuse existing serializers, permission classes, and validation helpers instead of re-implementing them in a view.
- If logic is needed in more than one app, put it in the app that owns the domain, or in a small shared module if it's clearly cross-cutting — avoid circular imports.

### 3.6 Logging

- Log meaningful actions (auth events, content publish/approve/reject, permission/role changes, failed authorization checks) with enough context to answer who/what/when/object/action later — this feeds the audit system described in `docs/VISION.md` §30.
- **Never** log raw passwords, tokens, session cookies, or authorization headers, even in debug-level logs.
- Prefer a single project-wide logging helper over ad-hoc `logging.getLogger(__name__)` calls scattered per view once one exists; until then, use Django's standard logging with a consistent logger name per app.

---

## 4. Frontend conventions (Next.js)

### 4.1 Stack and tooling

- **Node.js 24** (matches `frontend/Dockerfile` and CI).
- **npm** with `package-lock.json` — avoid introducing yarn/pnpm lockfiles.
- New code must type-check: run `npm run build` before merging.
- Run `npm run lint` and fix new violations in files you touch.
- Run `npm test` (Vitest) and fix/add tests for files you touch — see §4.8.

### 4.2 Project structure and routing

- Routes live under `app/[locale]/...` (App Router + `next-intl`). Auth/role-gated routes are grouped under `(protected)` (e.g. `app/[locale]/(protected)/knowledge/`) rather than sprinkling `if (!user)` checks through pages; `login/` and `register/` stay outside that group.
- Keep pages thin — push data fetching and API calls into a dedicated layer (see 4.3) rather than inlining `fetch` in components.

### 4.3 API layer

- Centralize calls to the Django API behind a small client module (e.g. `frontend/lib/api/`) with typed functions, instead of scattering ad-hoc `fetch` calls across components.
- The API base URL comes from `NEXT_PUBLIC_API_URL` (see `frontend/.env.example`). It's inlined into the client bundle at build time — see the note in `frontend/Dockerfile` and `docker-compose.prod.yml` about passing it as a build arg, not just a runtime env var, in prod images.
- Auth is a Bearer access token (in-memory) plus an httpOnly refresh cookie — there's no session-cookie fallback for API auth. A plain `<img src>` or direct browser navigation to a protected endpoint can't attach the token, so any binary content gated like that (see `backend/files/views.py`) has to be fetched via `apiFetch` and rendered from a blob/object URL — see `frontend/components/ui/AuthenticatedImage.tsx` and `lib/api/files.ts`'s `downloadFile()` for the pattern, rather than a raw `<a href>`/`<img src>` to the API URL.

### 4.4 State and data fetching

- Keep global client state in a small number of well-defined stores (e.g. Zustand, once introduced) rather than prop-drilling or scattering context providers.
- Prefer server components where the page's data doesn't need client interactivity; add `"use client"` only when you need hooks, browser APIs, or event handlers.

### 4.5 UI and styling

- Reuse the shared UI primitives in `frontend/components/ui/` (`Button`, `Modal`, `ConfirmModal`, `Combobox`, `DatePicker`, `FloatingLabelInput`, `Markdown`, `MarkdownEditor`, `AuthenticatedImage`, ...) and existing layout patterns instead of one-off component styling. This custom Radix/cmdk-based kit is the current primitive layer; `shadcn/ui` (see `docs/VISION.md` §32) is only under evaluation as a possible future replacement, not yet adopted.
- Styling uses Tailwind CSS; follow existing class naming and responsive breakpoints.
- **Dark mode**: all UI must work in both themes. Don't use a hardcoded light background/text class (`bg-white`, `text-slate-900`) without its dark counterpart (`dark:bg-slate-900`, `dark:text-white`). Prefer CSS variables that adapt automatically where the design system provides them.

### 4.6 Internationalization (i18n)

The app is routed under `app/[locale]/...` (via `next-intl`, `frontend/i18n/request.ts`) with `localePrefix: "always"` — every route is prefixed (`/en/...`, `/ar/...`), and `frontend/proxy.ts` handles both the locale redirect and the auth check together.

- **No static text.** Every user-facing string — labels, button text, placeholders, `aria-label`s, error/success messages — must come from `useTranslations()` (client components) or `getTranslations()` (server components), reading from `frontend/i18n/messages/en.json`. Never hardcode English (or any language) directly in JSX. The one narrow exception is the top-level `app/not-found.tsx`/error boundaries that can render before a locale is even resolved.
- Use `Link`, `useRouter`, `usePathname`, `redirect` from `@/i18n/navigation` (not `next/link` / `next/navigation`) anywhere under `app/[locale]/` — with `localePrefix: "always"`, plain Next.js navigation APIs won't carry the locale prefix and will produce broken links.
- Keys are namespaced by feature/component (see `en.json`'s existing structure: `common`, `auth`, `nav`, `topbar`, `settings.general`, `settings.branding`, etc.) — add new keys under the relevant namespace rather than a flat top-level key.
- **Adding a new language**: add its code to `locales` in `frontend/i18n/request.ts`, give it a display name in `localeNames` and a text direction in `localeDirections` (also in `request.ts`), then add a `frontend/i18n/messages/<code>.json` file with the same keys as `en.json` (copy `en.json` as a starting point and translate the values). The Settings > General language picker is generated from `locales`/`localeNames`, so a language only appears there once its message file exists — there's no separate hardcoded language catalogue to update.
- `ar.json` is genuinely translated (not a copy of `en.json`) and kept in sync key-for-key — when adding a language that isn't yet fully translated, lagging wording quality is fine temporarily, but a key present in `en.json` and missing from another locale's file is not: next-intl has no per-key fallback configured and will error on a genuinely missing key.

### 4.7 Permission gating (client-side)

The backend is the only real access-control boundary — see §6. This section is purely about UX: don't render a control that would just 403 if the user clicked it.

- `frontend/lib/auth/permissions.ts` exports `useHasPermission(codename?)`, a hook reading `user.permissions` (populated from `GET /api/v1/auth/me/`, which mirrors `User.permission_codenames()` on the backend — see `backend/accounts/models.py`). Omitting `codename` always returns `true`, so optional per-item checks don't need a separate branch.
- `frontend/components/auth/Can.tsx` wraps that hook for declarative JSX gating: `<Can permission="role.manage">...</Can>` renders nothing (or a `fallback`) when the permission is missing.
- **Menus/nav items**: give the item's config an optional `permission` field and gate it with `<Can>` (see `NAV_ITEMS` in `frontend/components/layout/SideNav.tsx`) instead of a scattered `{condition && <Link>}`.
- **Pages with multiple independently-gated parts**: compute one `useHasPermission(...)` boolean per part and only fetch/render that part when it's true — don't fetch data the user's permission set can't reach (see `frontend/components/settings/RolesSettingsForm.tsx`, which gates its permissions-catalogue section on `permission.manage` and its user-assignment section on `user.manage` independently).
- **Read-only-for-everyone vs gated-read**: if an endpoint is genuinely public to read and only writes are gated (e.g. organization general/branding settings), keep rendering the view and gate just the edit controls via a `canEdit` boolean prop passed down from the page (see `GeneralSettingsForm`/`BrandingSettingsForm`). If the *read* itself requires a permission (e.g. `role.manage` on `GET /rbac/roles/`), gate the whole section/tab instead — there's nothing to show without it.
- **Adding a new permission codename**: add it to `PERMISSION_CATALOGUE` (and to a `ROLE_CATALOGUE` entry, if a default role should grant it) in `backend/rbac/management/commands/seed_rbac.py`, then re-run `uv run manage.py seed_rbac`. Enforce it on the view with `rbac.permissions.require_permission("your.codename")` — don't build a parallel authorization mechanism per app.

### 4.8 Testing

The frontend's test suite is new and deliberately small (see `docs/VISION.md` §32 "Testing") — this section is the starting strategy, not a mature convention yet.

- **Stack**: [Vitest](https://vitest.dev) + [React Testing Library](https://testing-library.com/react), configured in `frontend/vitest.config.ts` (jsdom environment, `@vitejs/plugin-react`, `@testing-library/jest-dom` matchers loaded via `vitest.setup.ts`). Chosen over Jest for ESM-native config that doesn't fight the project's `moduleResolution: "bundler"` TypeScript setup. Tests deliberately skip the React Compiler Babel transform — it's a build-time optimization, irrelevant to whether the logic under test is correct.
- **Run with**: `npm test` (single run, what CI should use) or `npm run test:watch` (watch mode during development).
- **What to prioritize, in order**:
  1. Pure functions in `lib/` with no React/network dependency (e.g. `lib/format.ts`, `lib/slug.ts`, `lib/toc.ts`) — cheapest to test, easiest to keep passing.
  2. Small, clearly-scoped logic that only needs one hook or module mocked (e.g. `lib/auth/permissions.ts`'s `useHasPermission`, mocking `useAuth`; `lib/api/client.ts`'s `extractApiError`, constructing a fake `Response`-shaped object rather than a real fetch).
  3. Small presentational components with a clear prop surface (e.g. `components/ui/Avatar.tsx`) — mock child components that do their own data fetching (see `Avatar.test.tsx` mocking `AuthenticatedImage`) rather than pulling `apiFetch` into a component test.
  4. Anything that calls `apiFetch` directly, full pages, or components with heavy `next-intl`/routing dependencies — not yet attempted; don't reach for a network-mocking library (e.g. MSW) until a test actually needs one, per the "don't add infrastructure ahead of a real need" principle elsewhere in this doc.
- **Co-locate tests** with the code they cover (`format.ts` → `format.test.ts` next to it), matching this project's existing "keep related things together" pattern rather than a parallel `__tests__/` tree.
- Not yet covered by any test, deliberately deferred rather than an oversight to fix immediately: component tests for anything hitting `apiFetch`, page-level tests, and end-to-end/browser tests (Playwright is listed as a future addition in `docs/VISION.md` §32, not started).

---

## 5. Backend/frontend contract

- The frontend targets the Django REST API. `drf-spectacular`'s OpenAPI schema (`/api/schema/`, with Swagger UI at `/api/docs/` — both `DEBUG`-only) is the source of truth for response shapes.
- Breaking API changes should be coordinated between whoever owns the change on each side; prefer defensive parsing (optional fields) while the API is still evolving pre-V1.

---

## 6. Security

- Never commit `.env`, `.env.local`, tokens, or production URLs/credentials. `scripts/generate_env.py` and the `.gitignore`/`.gitattributes` setup exist specifically so this doesn't happen by accident.
- Treat every `NEXT_PUBLIC_*` variable as **public** — it ships to the browser. Never put a secret there.
- Per `docs/VISION.md` §28: **the frontend is not a security boundary.** Every API endpoint must independently enforce authentication and authorization — hiding a button in the UI is not access control. Someone hitting the API directly (curl/Postman) must be restricted exactly the same as someone using the UI.

---

## 7. Pull requests

- Keep diffs focused on the feature or fix; avoid unrelated refactors or formatting-only churn in files you didn't need to touch.
- Describe **what** changed and **why** in the PR description.
- `pr-checks.yml` validates the PR title format and labels the PR by size/changed paths — expect a bot comment if the title doesn't follow the convention in §2.
- `ci.yml` must pass: backend checks/migrations/tests, frontend lint/build, and a Docker build of all four image targets.

---

## 8. Summary checklist

- [ ] **Commits**: follow the Angular convention (§2) — PR title included, since `pr-checks.yml` validates it.
- [ ] **API**: every view has `@extend_schema` with tags and all response options (success + errors), reusing shared error schemas.
- [ ] **Migrations**: new model changes have a matching migration; no edits to already-applied migrations; hand-written ones follow the `NNNN_manual_...` naming convention.
- [ ] **Utils vs services**: helpers in `utils.py`, business logic in `services.py`; no duplicated logic.
- [ ] **Reuse**: existing utils/services/serializers/components used instead of parallel implementations.
- [ ] **Frontend**: `npm run lint`, `npm run build`, and `npm test` pass; dark mode works; no secrets in `NEXT_PUBLIC_*`.
- [ ] **i18n**: no hardcoded UI text — every string goes through `useTranslations`/`getTranslations`; new keys added to `en.json` (and kept in sync, even if untranslated, in every other locale file).
- [ ] **Security**: no new endpoint relies on frontend-only access control; no secrets committed or logged.
- [ ] **Permission gating** (§4.7): new gated UI uses `useHasPermission`/`<Can>` rather than ad hoc `user.permissions.includes(...)`; any new codename is added to `seed_rbac.py`'s catalogue and enforced server-side with `require_permission`.
- [ ] **CI**: `ci.yml` passes (backend, frontend, docker jobs).

If you have questions, open an issue or ask the maintainers.
