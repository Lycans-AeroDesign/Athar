"""Celery app instance - currently only used for backups.tasks (org backup
export). Broker/result backend and other CELERY_* settings live in
config/settings.py, read via the `namespace="CELERY"` call below (so a
setting there named `CELERY_BROKER_URL` becomes Celery's `broker_url`)."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("config")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
