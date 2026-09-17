from celery import shared_task

from . import services


@shared_task
def delete_unconfirmed_files() -> int:
    """Runs services.delete_unconfirmed_files on a schedule - see
    config/settings.py's CELERY_BEAT_SCHEDULE and StoredFile.confirmed_at's
    docstring for the staging/confirm design this reclaims."""
    return services.delete_unconfirmed_files()
