from django.conf import settings
from django.db import models

from core.models import TimeStampedModel, UUIDPrimaryKeyModel


class Subscription(UUIDPrimaryKeyModel, TimeStampedModel):
    """An organization's hosting subscription (one per org). Platform-level data, managed by
    instance operators only and deliberately left out of org backups/restore (backups/services.py)
    so restoring an old archive can't roll back `paid_until`. The status is derived from the dates
    on every read (billing.services.evaluate), never stored, and only enforced while the platform
    switch is on (platform_admin.models.subscriptions_enabled)."""

    organization = models.OneToOneField(
        "organization.Organization", on_delete=models.CASCADE, related_name="subscription"
    )
    # Never billed: orgs that existed before billing, or were created while it was switched off.
    exempt = models.BooleanField(default=False)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    paid_until = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # Optional caps (null = unlimited), enforced only while billing is switched on: active members
    # (accounts.services.register_user) and total uploaded bytes (files.services.upload_file).
    max_users = models.PositiveIntegerField(null=True, blank=True)
    max_storage_gb = models.PositiveIntegerField(null=True, blank=True)
    # Which reminder email went out last (billing.tasks), e.g. "2027-06-01T00:00:00+00:00|7", so
    # the daily task never sends the same one twice. Resets naturally when access_until moves.
    last_reminder = models.CharField(max_length=60, blank=True)

    def __str__(self):
        return f"Subscription({self.organization_id})"


class Payment(UUIDPrimaryKeyModel, TimeStampedModel):
    """One annual payment recorded by a platform admin. Kept as immutable history: corrections
    are made by adjusting Subscription.paid_until, not by editing past payments."""

    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3)
    paid_on = models.DateField()
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-paid_on", "-created_at"]

    def __str__(self):
        return f"{self.amount} {self.currency} on {self.paid_on}"
