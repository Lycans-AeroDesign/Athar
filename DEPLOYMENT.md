# Deploying Athar

This is the checklist for taking `docker-compose.prod.yml` from a laptop to a real server (Oracle Cloud, or any VM/host that can run Docker). It only covers **what to change** — see [`README.md`](README.md#quickstart-docker) for general Docker Compose usage.

nginx terminates HTTPS itself using a free certificate from [Let's Encrypt](https://letsencrypt.org/), auto-renewed by a `certbot` sidecar container — no CDN/third party sits in front of your traffic. DNS points straight at your server's IP.

## 1. Prerequisites

- A domain name with its DNS `A` (and `AAAA`, if using IPv6) record pointed at your server's public IP.
- Docker + the Docker Compose plugin installed on the server.
- Inbound TCP ports **80 and 443** open in both the instance's cloud-side firewall and its OS-level firewall. On Oracle Cloud specifically: open them in the instance's **Security List/Network Security Group**, *and* in the OS firewall (`iptables`/`firewalld`) — Oracle's images typically block these at the OS level even after the cloud-side security list allows them.
- Port 80 has to stay reachable permanently, not just during setup — Let's Encrypt re-verifies domain ownership on every renewal (roughly every 60 days) the same way it does on first issuance.

## 2. Publish the images (once, before first deploy)

`docker-compose.prod.yml` pulls prebuilt images from GHCR rather than building on the server - important on small/free-tier VMs, where building the frontend and backend locally can exhaust RAM. Publish them from GitHub instead:

1. Repo → **Settings → Secrets and variables → Actions → Variables** tab → add a repository variable named `NEXT_PUBLIC_API_URL` set to your real origin + `/api`, e.g. `https://athar.example.com/api`. (Variable, not Secret - this value ends up in the public frontend JS bundle regardless, so there's nothing to protect.)
2. Tag a release and push it: `git tag v1.0.0 && git push origin v1.0.0`. This triggers `.github/workflows/docker-publish.yml`, which builds both images on GitHub's runners and pushes them to `ghcr.io/<owner>/<repo>-backend` and `-frontend`, tagged both `v1.0.0` and `latest`. (You can also trigger it manually from the Actions tab for a one-off build.)
3. Make the packages pullable: repo/org → **Packages** tab → open each of `<repo>-backend` and `<repo>-frontend` → package settings → **Change visibility → Public** (simplest if your repo is already public - otherwise the server needs `docker login ghcr.io` with a PAT instead).

Repeat step 2 (a new tag) whenever you want to ship a new version - see [Every deploy after the first](#6-every-deploy-after-the-first) below.

## 3. Clone and generate secrets

```bash
git clone https://github.com/Lycans-AeroDesign/Athar.git
cd Athar
python scripts/generate_env.py
```

This creates a root `.env` with a random `SECRET_KEY` and `POSTGRES_PASSWORD` already filled in. Never deploy with the `.env.example` placeholder values.

## 4. Edit `.env`

| Variable | Set it to | Notes |
|---|---|---|
| `DOMAIN` | your real domain, e.g. `athar.example.com` | nginx's `server_name` and the certificate's domain — required |
| `LETSENCRYPT_EMAIL` | an email you actually check | Let's Encrypt sends expiry/renewal-problem notices here — required |
| `ALLOWED_HOSTS` | same domain, e.g. `athar.example.com` | Django rejects requests for any host not listed here — required |
| `CORS_ALLOWED_ORIGINS` | `https://athar.example.com` | required |
| `IMAGE_TAG` | a published tag, e.g. `v1.0.0`, or `latest` | which GHCR image build to pull — see step 2 |
| `ENABLE_REGISTRATION` | `True` or `False` | your call — whether public self-signup should be open |
| `AWS_STORAGE_BUCKET_NAME` + the 4 `AWS_*` vars below it | only if using S3/R2/B2/MinIO | optional — leave blank to keep local-disk storage |

`NEXT_PUBLIC_API_URL` in this file is **not** used in production — it's baked into the frontend image at publish time from the `NEXT_PUBLIC_API_URL` GitHub repo variable instead (step 2). Everything else in `.env` (`POSTGRES_*`, `JWT_*`, `NGINX_PORT`/`NGINX_SSL_PORT`, `SECRET_KEY`) is already either generated for you or fine to leave at its default.

## 5. First deploy — one-time certificate bootstrap

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d db redis backend celery-worker frontend
bash scripts/init_letsencrypt.sh
```

Why this extra step exists: nginx refuses to start with `ssl_certificate` pointing at a file that doesn't exist, but Let's Encrypt's verification needs nginx already running on port 80 to serve the challenge that proves you own the domain. `scripts/init_letsencrypt.sh` breaks that chicken-and-egg loop for you — see the comments at the top of that script for exactly what it does. It prints progress as it goes and takes under a minute.

After it finishes successfully, everything is up and `https://<your-domain>` is live with a real, trusted certificate.

## 6. Every deploy after the first

Publish a new tag on GitHub first (step 2), set `IMAGE_TAG` in `.env` to it (or leave as `latest` to always track the newest push), then:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

No certificate steps needed again — the `certbot` service checks twice a day and renews automatically well before the 90-day Let's Encrypt certificate would expire.

Check `docker compose -f docker-compose.prod.yml logs -f` for startup issues, and `https://<your-domain>/api/v1/health/` to confirm the backend is reachable end-to-end.

## 7. After it's running

- Create your first organization/admin account through the app itself (registration flow, or `docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser` for a break-glass Django admin account — see [`README.md`](README.md#backups) for what admin access is/isn't used for).
- Set up periodic `manage.py create_full_backup` runs (cron, or your own scheduler) if you want off-server backups — see [Backups](README.md#backups).

## Not using this exact setup?

- **Prefer a CDN (Cloudflare, etc.) in front instead of nginx handling certs directly?** That's a different, simpler nginx config (no certbot, no cert volumes) but needs its own trusted-proxy handling for real visitor IPs. Ask if you want this wired up instead.
- **No domain yet, just want to try it on a VM's bare IP?** Skip section 5 entirely and use `docker-compose.yml` (the dev stack) instead of `docker-compose.prod.yml` — plain HTTP, no certs, not meant to stay running for real users.
