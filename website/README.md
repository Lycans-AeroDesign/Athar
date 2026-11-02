# Athar website

The public landing page for **Athar (أثر)**: a single static page built with Next.js 16, React 19, TypeScript and Tailwind CSS v4.

It is deliberately separate from the application in `../frontend`. It has no backend, no database, no authentication, and no connection to any Athar deployment (including Lycans' own). Everything it shows is static content and demo-data screenshots.

## Local development

Requires Node.js 20+.

```bash
cd website
npm install
npm run dev          # http://localhost:3000
```

Before merging:

```bash
npm run lint
npm run build        # also the type-check
```

## Editing content

All copy, links, the feature list, the roadmap and screenshot metadata live in **[`content/site.ts`](content/site.ts)**. Most updates don't need any component changes.

Rules for editing it:

- **Features:** only list something under `features` once it's merged on `main`. Anything that isn't shipped yet goes under `roadmap`, which the page labels "Planned — not available yet". Keep `roadmap` in step with `docs/VISION.md` §41.
- **Links:** every external link must point to a destination you have opened.
- **No claims you can't back up:** no testimonials, customer logos, usage numbers or hosted/subscription offers.

| What | Where |
|---|---|
| Copy, links, features, roadmap | `content/site.ts` |
| Colors / theme tokens (dark default + light) | `app/globals.css` (`:root` and `[data-theme="light"]`) |
| Page sections | `components/sections/*.tsx`, in order in `app/page.tsx` |
| Relationship graph (Fig. 03) | `components/sections/Solution.tsx` |
| Logo mark | `components/Logo.tsx` and `app/icon.svg` (favicon) |
| Social card | `app/opengraph-image.tsx` (generated at build time) |
| Metadata, fonts | `app/layout.tsx` |

## Production domain

The site's public URL comes from one environment variable:

```bash
NEXT_PUBLIC_SITE_URL=https://athar.example.org   # no trailing slash
```

It drives the canonical URL, Open Graph/Twitter URLs, `sitemap.xml`, `robots.txt` and the JSON-LD `url`. If it isn't set, those fall back to `http://localhost:3000`. **Set it before the production build**, because the value is inlined at build time.

Setting up a domain:

1. Pick the hostname, e.g. `athar.lycansteam.com` (a subdomain) or a dedicated domain.
2. Set `NEXT_PUBLIC_SITE_URL` to it in the hosting provider's environment settings (or in `.env.production`), then rebuild.
3. Point DNS at the host:
   - **Vercel:** add the domain under *Project → Settings → Domains*, then create the `CNAME` (subdomain) or `A` record (apex) that Vercel shows you.
   - **Own server:** an `A`/`AAAA` record to the server, and HTTPS via your reverse proxy (see below).
4. Check `https://<domain>/robots.txt`, `/sitemap.xml` and `/opengraph-image`, and test the link in a social-card validator.

This site must **not** share a hostname with a real Athar instance, and must never link to Lycans' private deployment.

## Deployment

The page prerenders fully static (`○` for every route in `npm run build`). It uses `next/image` for screenshot optimisation (AVIF/WebP, responsive sizes, lazy loading), so it should be served by a Next.js runtime.

**Vercel (simplest):** import the repo, set *Root Directory* to `website`, add `NEXT_PUBLIC_SITE_URL`, and deploy. Image optimisation works out of the box.

**Any Node host / your own server:**

```bash
cd website
npm ci
NEXT_PUBLIC_SITE_URL=https://athar.example.org npm run build
npm run start -- -p 3000      # put nginx/Caddy in front for HTTPS
```

If you ever need pure static hosting (GitHub Pages, S3), add `output: "export"` and `images: { unoptimized: true }` to `next.config.ts`. The screenshots are then served as unoptimised PNGs (about 0.25–0.5 MB each), so convert them to WebP first.

## Screenshots and assets

### Currently used

Copied from `docs/marketing/screenshots/`, all taken from a demo instance with **fictional** people and records:

| File | Used in |
|---|---|
| `public/screenshots/light-hero.png` | Hero (Fig. 01), Showcase "Article", social card |
| `public/screenshots/light-failure.png` | Showcase "Failure record" |
| `public/screenshots/light-components.png` | Showcase "Components" |
| `public/screenshots/light-search.png` | Showcase "Search" |
| `public/screenshots/light-course.png` | Showcase "Training" |
| `public/screenshots/light-test-data.png` | Showcase "Engineering data" |
| `public/screenshots/light-mobile-article.png` | Showcase, phone figure (Fig. 05) |

`light-dashboard.png` is deliberately **not** used: its contributor list shows a real-looking email address (`admin@lycans.com`) and a photo avatar, and the board shows an internal-notes article title.

### Still needed from the Athar application

Capture these from a demo instance seeded with fictional data, at 1600×1000 CSS px with 2× device scale (3200×2000 files) to match the existing set:

1. **Dashboard** (replaces the omitted one): no real emails or photos; fictional contributors only.
2. **Dark-theme versions** of the article and component screenshots. The page is dark-first, and dark shots would let the hero sit more quietly on it.
3. **Arabic / RTL view** of an article or the dashboard, to show the bilingual support.
4. **Project detail page** showing linked components, failures and tests.
5. **SOP detail page.**
6. **Q&A question page** with an accepted answer.
7. **Knowledge browse page** (categories/tags).
8. **Related-content link picker** (adding a relation), to show how links are made.

Checklist for every screenshot: fictional names only, no real emails, no profile photos, no internal or private documents, no production hostname in the browser bar (the site's frame shows "athar · demo instance" instead of a URL).

### Brand assets

- **Logo:** there is no official Athar logo yet. `components/Logo.tsx` and `app/icon.svg` use a placeholder mark (three linked nodes fading along a diagonal, for a *trace* / أثر). Replace both together once a real logo exists. An SVG is preferred, plus a 512×512 PNG for `app/apple-icon.png`.
- **Fonts:** Inter, JetBrains Mono and Newsreader Italic are self-hosted from `app/fonts/` (the same files the app uses). IBM Plex Sans Arabic (for "أثر") is loaded through `next/font/google`, which downloads it at build time, so the build machine needs internet access or the font falls back to the system Arabic font.
