from django.db import models

from core.models import TimeStampedModel, UUIDPrimaryKeyModel


class Organization(UUIDPrimaryKeyModel, TimeStampedModel):
    """The multi-tenancy root: every tenant-owned row traces back to one via
    core.OrganizationScopedModel or a direct FK (accounts.User). Deliberately minimal; no
    billing/plan/quota fields.

    `slug` is reserved for future subdomain routing and isn't wired up; requests resolve their
    organization from `request.user.organization`."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=100, unique=True)
    # Platform-level kill switch (platform_admin app): a suspended org's users can't log in or
    # use the API. Not a billing/plan field.
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class OrganizationSettings(models.Model):
    """One row per Organization: branding/general config. Always use
    OrganizationSettings.load(organization), never .objects.create() directly."""

    organization = models.OneToOneField(
        Organization, on_delete=models.CASCADE, primary_key=True, related_name="settings"
    )

    # General
    # No stored timezone (timestamps render in the viewer's local timezone, see
    # frontend/lib/datetime.ts) and no stored language (a per-viewer NEXT_LOCALE cookie).
    name = models.CharField(max_length=200, default="Athar")

    # Branding
    logo = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    favicon = models.ForeignKey(
        "files.StoredFile", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    primary_color = models.CharField(max_length=7, default="#1D4ED8")
    secondary_color = models.CharField(max_length=7, default="#505F76")
    # Dark-theme counterparts: the frontend applies the pair matching the active theme.
    # Defaults match the built-in dark palette (frontend/app/[locale]/globals.css).
    primary_color_dark = models.CharField(max_length=7, default="#B7C4FF")
    secondary_color_dark = models.CharField(max_length=7, default="#B8C7E2")

    # Org-wide kill switch for the first-run product tour (frontend/lib/onboarding/tour.ts),
    # separate from a user having seen it (accounts.User.preferences.has_completed_tour).
    # On by default.
    product_tour_enabled = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls, organization: Organization) -> "OrganizationSettings":
        # Deliberately not defaulting `name` to organization.name: that's the tenant's
        # registered identity, while this is a customizable display name that starts at the
        # field default ("Athar") until renamed via organization.manage.
        instance, _ = cls.objects.get_or_create(organization=organization)
        return instance

    def __str__(self):
        return self.name
