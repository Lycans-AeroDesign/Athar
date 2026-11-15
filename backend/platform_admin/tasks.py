from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import ErrorEvent


@shared_task
def purge_old_error_events() -> int:
    """Drop error-log entries not seen for ERROR_LOG_RETENTION_DAYS (scheduled daily)."""
    cutoff = timezone.now() - timedelta(days=settings.ERROR_LOG_RETENTION_DAYS)
    deleted, _ = ErrorEvent.objects.filter(last_seen__lt=cutoff).delete()
    return deleted
