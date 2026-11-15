"""Docker healthcheck for the web container: GET /api/v1/health/ (which also
checks the database) on the local server; exit 0 when it answers 200.

Django rejects a Host header outside ALLOWED_HOSTS with a 400, and prod's
ALLOWED_HOSTS is the real domain, not 127.0.0.1 - so the request names the
first allowed host instead (a leading-dot entry like ".example.com" also
matches the bare domain; "*" accepts anything).
"""

import os
import sys
import urllib.request

hosts = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip() and h.strip() != "*"]
host = hosts[0].lstrip(".") if hosts else "localhost"

request = urllib.request.Request("http://127.0.0.1:8000/api/v1/health/", headers={"Host": host})
try:
    with urllib.request.urlopen(request, timeout=5) as response:
        sys.exit(0 if response.status == 200 else 1)
except Exception as exc:  # any failure (refused, timeout, 4xx/5xx) means unhealthy
    print(f"healthcheck failed: {exc}", file=sys.stderr)
    sys.exit(1)
