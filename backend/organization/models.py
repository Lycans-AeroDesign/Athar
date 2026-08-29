import uuid

from django.db import models


class OrganizationSettings(models.Model):
    """Singleton - use OrganizationSettings.load(), never .objects.create() directly.

    Single-org-per-installation (see docs/VISION.md section 2), so there is
    exactly one row; UUID pk kept for consistency with every other model
    rather than hard-coding pk=1.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # General
    # No stored timezone - every timestamp is rendered in the viewer's local
    # timezone client-side (see frontend/lib/datetime.ts), auto-detected via
    # the browser, not configured per-organization.
    name = models.CharField(max_length=200, default="AeroKMS")
    primary_domain = models.CharField(max_length=255, blank=True)
    default_language = models.CharField(max_length=20, default="en-US")

    # Branding
    logo = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    favicon = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    primary_color = models.CharField(max_length=7, default="#1D4ED8")
    secondary_color = models.CharField(max_length=7, default="#505F76")

    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls) -> "OrganizationSettings":
        instance = cls.objects.first()
        if instance is None:
            instance = cls.objects.create()
        return instance

    def __str__(self):
        return self.name
