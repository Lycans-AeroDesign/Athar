"""Gunicorn settings for the prod image (backend/Dockerfile's prod CMD).

Previously `--workers 3` with the default sync workers and 30s timeout: one
slow request held a whole worker (a third of capacity), and a large backup
restore upload - decrypted and validated inside the request - outlived the
timeout and got its worker killed even though nginx allows 300s for it.

gthread workers run several requests per process on threads. Their timeout
only fires when a worker process stops responding, not when a single request
runs long, so slow uploads finish while the other threads keep serving.
"""

import os

bind = "0.0.0.0:8000"

# 3 x 4 = 12 requests in flight. Workers are the memory cost (~150 MB each), so
# small VMs keep few workers and get concurrency from threads instead.
workers = int(os.environ.get("WEB_CONCURRENCY", "3"))
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", "4"))

# Only a hung worker process trips this with gthread (see module docstring).
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5

# Recycle each worker after a while so slow memory growth can't build up;
# jitter keeps them from all restarting at once.
max_requests = 1000
max_requests_jitter = 100

accesslog = "-"
errorlog = "-"
