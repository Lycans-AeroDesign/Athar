#!/usr/bin/env bash
# One-time bootstrap for the Let's Encrypt certificate nginx uses in
# docker-compose.prod.yml - see DEPLOYMENT.md. Run this once, from the repo
# root, the first time you deploy to a new server. After this succeeds,
# renewal is fully automatic (the certbot service in docker-compose.prod.yml
# checks twice a day and only actually renews when needed).
#
# Why this script has to exist at all: nginx refuses to start with
# ssl_certificate pointing at a file that doesn't exist, but Let's
# Encrypt's webroot verification method needs nginx already running on
# port 80 to serve the challenge file that proves domain ownership. That's
# a chicken-and-egg loop. This script breaks it:
#   1. Write a throwaway self-signed certificate to the exact path nginx
#      expects, so nginx can start at all.
#   2. Start nginx (now serving the ACME challenge path, just with a
#      certificate no browser will trust yet - fine, nothing trusts it for
#      more than the few seconds until step 4).
#   3. Delete the throwaway certificate.
#   4. Ask certbot for the real certificate via the now-running nginx.
#   5. Reload nginx onto the real certificate.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
    echo "No .env found at repo root - run 'python scripts/generate_env.py' and fill it in first." >&2
    exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DOMAIN:?Set DOMAIN in .env first (your real public domain)}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in .env first - used only for certificate expiry/renewal-problem notices from the CA}"

COMPOSE=(docker compose -f docker-compose.prod.yml)

# Generates the throwaway cert via Python's `cryptography` library rather
# than shelling out to an `openssl` CLI, since certbot's own image is
# guaranteed to have the former (it's one of certbot's own hard runtime
# dependencies) but not necessarily the latter.
DUMMY_CERT_SCRIPT='
import datetime, os
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

domain = os.environ["DOMAIN"]
live_dir = f"/etc/letsencrypt/live/{domain}"
os.makedirs(live_dir, exist_ok=True)

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, domain)])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(name)
    .issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now)
    .not_valid_after(now + datetime.timedelta(days=1))
    .sign(key, hashes.SHA256())
)
with open(f"{live_dir}/privkey.pem", "wb") as f:
    f.write(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ))
with open(f"{live_dir}/fullchain.pem", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))
print(f"Wrote a temporary self-signed certificate to {live_dir}")
'

echo "==> [1/5] Writing a temporary self-signed certificate so nginx can start..."
"${COMPOSE[@]}" run --rm -e DOMAIN="$DOMAIN" --entrypoint python3 certbot -c "$DUMMY_CERT_SCRIPT"

echo "==> [2/5] Starting nginx..."
"${COMPOSE[@]}" up -d nginx

echo "==> [3/5] Deleting the temporary certificate..."
"${COMPOSE[@]}" run --rm --entrypoint rm certbot -rf "/etc/letsencrypt/live/$DOMAIN" "/etc/letsencrypt/archive/$DOMAIN" "/etc/letsencrypt/renewal/$DOMAIN.conf"

echo "==> [4/5] Requesting the real certificate from Let's Encrypt for $DOMAIN..."
"${COMPOSE[@]}" run --rm --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot \
    --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN" \
    --rsa-key-size 2048 --agree-tos --non-interactive

echo "==> [5/5] Reloading nginx onto the real certificate..."
"${COMPOSE[@]}" exec nginx nginx -s reload

echo
echo "Done - https://$DOMAIN should now be serving a real, trusted certificate."
echo "Renewal is automatic from here on (see the certbot service in docker-compose.prod.yml)."
