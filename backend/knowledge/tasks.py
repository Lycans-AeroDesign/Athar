from celery import shared_task

from . import trash


@shared_task
def purge_expired_trash() -> int:
    """Daily: permanently deletes whatever has been in the trash longer than
    TRASH_RETENTION_DAYS - see knowledge/trash.py."""
    return trash.purge_expired()
