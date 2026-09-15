# Deploying Athar

This is the checklist for taking `docker-compose.prod.yml` from a laptop to a real server (Oracle Cloud, or any VM/host that can run Docker). It only covers **what to change** — see [`README.md`](README.md#quickstart-docker) for general Docker Compose usage.

nginx terminates HTTPS itself using a free certificate from [Let's Encrypt](https://letsencrypt.org/), auto-renewed by a `certbot` sidecar container — no CDN/third party sits in front of your traffic. DNS points straight at your server's IP.

## 1. Prerequisites

- A **static** public IP for your server, with a DNS `A` (and `AAAA`, if using IPv6) record pointed at it. On Google Cloud specifically: a fresh GCE instance's IP is ephemeral by default and can change on restart — reserve it as static first (**VPC network → IP addresses** → find the VM's IP → **Convert to static address**) before pointing DNS at it.
- Docker + the Docker Compose plugin installed on the server.
- Inbound TCP ports **80 and 443** open in both the instance's cloud-side firewall and its OS-level firewall.
  - **Oracle Cloud**: open them in the instance's **Security List/Network Security Group**, *and* in the OS firewall (`iptables`/`firewalld`) — Oracle's images typically block these at the OS level even after the cloud-side security list allows them.
  - **Google Cloud (GCE)**: create a firewall rule under **VPC network → Firewall** (ingress, allow, `tcp:80,443`, source `0.0.0.0/0`) targeted at your VM via a network tag — then add that *same* tag to the VM itself (VM details → **Edit** → **Networking → Network tags**), and make sure you scroll down and click **Save** on the edit page, not just add the tag chip. A rule with no matching tag on the VM silently does nothing.
- Port 80 has to stay reachable permanently, not just during setup — Let's Encrypt re-verifies domain ownership on every renewal (roughly every 60 days) the same way it does on first issuance.
- At least ~2GB RAM is recommended. This setup pulls prebuilt images (step 2) rather than building on the server, but Postgres + Redis + Django + Celery + Next.js + nginx + certbot running together can still get tight on a 1GB instance (e.g. GCP's free-tier `e2-micro`). If you're stuck on 1GB, add swap as a safety net so memory pressure slows things down instead of freezing the instance/killing SSH:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
  Swap only softens the failure mode (slower instead of the kernel SIGKILL-ing processes) - a 1GB instance is genuinely tight for this full stack (gunicorn's 3 workers, each a full Django process, plus Postgres/Redis/Celery/Next.js/nginx/certbot), and can still see workers OOM-killed mid-request under real usage, not just during a build. If that happens, resizing the instance up is the real fix, not further tuning.

## 2. Publish the images (once, before first deploy)

`docker-compose.prod.yml` pulls prebuilt images from GHCR rather than building on the server - important on small/free-tier VMs, where building the frontend and backend locally can exhaust RAM. Publish them from GitHub instead:

1. Tag a release and push it: `git tag v1.0.0 && git push origin v1.0.0`. This triggers `.github/workflows/docker-publish.yml`, which builds both images on GitHub's runners and pushes them to `ghcr.io/<owner>/<repo>-backend` and `-frontend`, tagged both `v1.0.0` and `latest`. (You can also trigger it manually from the Actions tab for a one-off build.) **Note:** if `release.yml`'s semantic-release creates the tag for you instead of a manual `git tag`, this auto-trigger only fires once a `RELEASE_TOKEN` secret is configured (see the comment at the top of `release.yml`) — GitHub doesn't let the default `GITHUB_TOKEN` trigger other workflows. Until then, trigger `docker-publish.yml` manually from the Actions tab after each release.
2. Decide whether the images stay public or private:
   - **Public** (simplest if the repo is already public): repo/org → **Packages** tab → open each of `<repo>-backend` and `<repo>-frontend` → package settings → **Change visibility → Public**.
   - **Private**: on the server, log in once before pulling: `echo <PAT> | docker login ghcr.io -u <github-username> --password-stdin`, using a PAT scoped to just `read:packages`. Persists in `~/.docker/config.json`, so this is a one-time step per server (until the PAT expires).

No `NEXT_PUBLIC_API_URL` setup needed - the published frontend image ships with no domain baked in at all, since `docker-compose.prod.yml`'s bundled nginx already proxies both it and the backend under whichever `DOMAIN` you set in step 4 below (see that section's note). This is also why anyone can reuse `ghcr.io/lycans-aerodesign/athar-frontend` directly behind their own domain without publishing their own build - only rebuild it yourself (via `docker-publish.yml`'s `workflow_dispatch` input) if you need the API reachable at a *different* origin than the one serving the frontend.

Repeat step 1 (a new tag) whenever you want to ship a new version - see [Every deploy after the first](#6-every-deploy-after-the-first) below.

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
| `IMAGE_TAG` | a published tag, e.g. `v1.0.0`, or `latest` | which GHCR image build to pull — see step 1 |
| `ENABLE_REGISTRATION` | `True` or `False` | your call — whether public self-signup should be open |
| `AWS_STORAGE_BUCKET_NAME` + the 4 `AWS_*` vars below it | only if using S3/R2/B2/MinIO | optional — leave blank to keep local-disk storage |

`NEXT_PUBLIC_API_URL` in this file is **not** used in production at all — the published frontend image ships with it empty (see [Publish the images](#2-publish-the-images-once-before-first-deploy) above), relying on `DOMAIN` (and the bundled nginx) instead. Everything else in `.env` (`POSTGRES_*`, `JWT_*`, `NGINX_PORT`/`NGINX_SSL_PORT`, `SECRET_KEY`) is already either generated for you or fine to leave at its default.

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

## Troubleshooting

- **`nano`/`dig`: command not found** — minimal cloud VM images (e.g. GCE's `ubuntu-minimal` family) often ship without either. Use `vi` in place of `nano`, and in place of `dig` for checking DNS propagation: `getent hosts <your-domain>`, or `curl -s "https://dns.google/resolve?name=<your-domain>&type=A"` if you want to bypass the server's own resolver cache.
- **`docker compose` hangs, then SSH stops responding entirely** — almost always the out-of-memory case described in Prerequisites above, not an actual hang. Check the VM's serial console output (cloud console → Logs → serial port, doesn't need SSH) for `Under memory pressure` / OOM-killer messages. Recovery is a hard reset of the instance (safe — nothing on disk is lost) followed by adding swap before retrying.

## Not using this exact setup?

- **Prefer a CDN (Cloudflare, etc.) in front instead of nginx handling certs directly?** That's a different, simpler nginx config (no certbot, no cert volumes) but needs its own trusted-proxy handling for real visitor IPs. Ask if you want this wired up instead.
- **No domain yet, just want to try it on a VM's bare IP?** Skip section 5 entirely and use `docker-compose.yml` (the dev stack) instead of `docker-compose.prod.yml` — plain HTTP, no certs, not meant to stay running for real users.
