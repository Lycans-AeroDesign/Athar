from celery import shared_task

from . import services


@shared_task
def request_password_reset(email: str, link_base: str, language: str) -> None:
    """Background half of PasswordResetRequestView - see
    services.request_password_reset for why this isn't done in the request."""
    services.request_password_reset(email=email, link_base=link_base, language=language)
