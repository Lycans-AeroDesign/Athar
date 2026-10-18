from django.conf import settings
from django.db import models


class PlatformSettings(models.Model):
    """Instance-wide switches an operator can flip at runtime (one row, pk=1). A null value
    means "not overridden": fall back to the matching environment setting."""

    organization_registration_enabled = models.BooleanField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "platform settings"

    @classmethod
    def load(cls) -> "PlatformSettings":
        instance, _ = cls.objects.get_or_create(pk=1)
        return instance


def organization_registration_enabled() -> bool:
    """Whether the public "create a new organization" signup is open: the operator's toggle if
    they've set one, else settings.ENABLE_ORGANIZATION_REGISTRATION."""
    override = PlatformSettings.objects.filter(pk=1).values_list("organization_registration_enabled", flat=True).first()
    return settings.ENABLE_ORGANIZATION_REGISTRATION if override is None else override
