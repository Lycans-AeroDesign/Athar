from celery import shared_task

from . import reminders


@shared_task
def send_subscription_reminders() -> int:
    """Daily (config/settings.py's CELERY_BEAT_SCHEDULE) - see billing/reminders.py."""
    return reminders.send_due_reminders()
