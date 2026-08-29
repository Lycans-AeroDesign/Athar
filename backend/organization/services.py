from audit.services import log_action

from .models import OrganizationSettings


def update_general(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="organization.update", target=settings, request=request)
    return settings


def update_branding(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="branding.update", target=settings, request=request)
    return settings
