from celery import shared_task

from . import services


@shared_task
def scrub_old_request_metadata() -> int:
    """Runs services.scrub_old_request_metadata on a schedule - see
    config/settings.py's CELERY_BEAT_SCHEDULE and AUDIT_IP_RETENTION_DAYS."""
    return services.scrub_old_request_metadata()
