from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import UUIDPrimaryKeyModel


class PlatformSettings(models.Model):
    """Instance-wide switches an operator can flip at runtime (one row, pk=1). A null value
    means "not overridden": fall back to the matching environment setting."""

    organization_registration_enabled = models.BooleanField(null=True, blank=True)
    # Billing (billing app): whether expired subscriptions are enforced, plus the flat annual
    # price and how to pay, both shown to org admins.
    subscriptions_enabled = models.BooleanField(null=True, blank=True)
    subscription_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    subscription_currency = models.CharField(max_length=3, default="USD")
    subscription_payment_instructions = models.TextField(blank=True)
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


def subscriptions_enabled() -> bool:
    """Whether org subscriptions are enforced (billing.services): the operator's toggle if
    they've set one, else settings.SUBSCRIPTIONS_ENABLED (off by default)."""
    override = PlatformSettings.objects.filter(pk=1).values_list("subscriptions_enabled", flat=True).first()
    return settings.SUBSCRIPTIONS_ENABLED if override is None else override


class ErrorEvent(UUIDPrimaryKeyModel):
    """One distinct error seen anywhere on the instance (platform_admin/error_log.py), grouped
    by fingerprint: a repeat bumps `count`/`last_seen` and replaces the stored details with the
    latest occurrence's instead of adding a row. Readable by platform admins only - a traceback
    or message can echo request data, so this is never exposed to organization admins."""

    class Source(models.TextChoices):
        BACKEND = "backend", "Backend"
        FRONTEND = "frontend", "Frontend"

    source = models.CharField(max_length=10, choices=Source.choices)
    fingerprint = models.CharField(max_length=64, unique=True)
    level = models.CharField(max_length=10, default="ERROR")
    logger = models.CharField(max_length=200, blank=True)
    exception_type = models.CharField(max_length=200, blank=True)
    message = models.TextField()
    traceback = models.TextField(blank=True)
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=500, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    organization = models.ForeignKey(
        "organization.Organization", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    count = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_seen"]

    def __str__(self) -> str:
        return f"{self.source}: {self.exception_type or self.level} {self.message[:80]}"
