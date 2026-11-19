from celery import shared_task

from . import services


@shared_task
def request_password_reset(email: str, link_base: str, language: str) -> None:
    """Background half of PasswordResetRequestView - see
    services.request_password_reset for why this isn't done in the request."""
    services.request_password_reset(email=email, link_base=link_base, language=language)


@shared_task
def purge_expired_token_rotations() -> int:
    """Daily (CELERY_BEAT_SCHEDULE): drops rotation records whose token has expired anyway."""
    return services.purge_expired_token_rotations()
