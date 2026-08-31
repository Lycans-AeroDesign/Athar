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
    # the browser, not configured per-organization. Language is likewise not
    # stored here - it's a per-viewer preference persisted client-side as the
    # NEXT_LOCALE cookie (see frontend/components/layout/TopBar.tsx), not an
    # org-wide default.
    name = models.CharField(max_length=200, default="Athar")
    primary_domain = models.CharField(max_length=255, blank=True)

    # Branding
    logo = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    favicon = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    primary_color = models.CharField(max_length=7, default="#1D4ED8")
    secondary_color = models.CharField(max_length=7, default="#505F76")
    # Dark-theme counterparts - the frontend applies whichever pair matches
    # the viewer's currently active theme (light/dark, resolving "system" via
    # prefers-color-scheme) rather than one fixed color for both. Defaults
    # match the app's built-in dark palette (frontend/app/[locale]/globals.css)
    # so existing installs look unchanged until an admin customizes them.
    primary_color_dark = models.CharField(max_length=7, default="#B7C4FF")
    secondary_color_dark = models.CharField(max_length=7, default="#B8C7E2")

    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls) -> "OrganizationSettings":
        instance = cls.objects.first()
        if instance is None:
            instance = cls.objects.create()
        return instance

    def __str__(self):
        return self.name
