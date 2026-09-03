from django.db import models

from core.models import TimeStampedModel, UUIDPrimaryKeyModel


class Organization(UUIDPrimaryKeyModel, TimeStampedModel):
    """The multi-tenancy root - every tenant-owned row across every app
    ultimately traces back to one of these via core.OrganizationScopedModel
    (knowledge/files/audit/rbac) or a direct FK (accounts.User). Deliberately
    minimal for now - no billing/plan/quota fields, per the explicit
    non-goals in the multi-tenancy plan this model was introduced for.

    `slug` is reserved for future subdomain-based routing (team-a.example.com)
    - not wired up anywhere yet; every request currently resolves its
    organization from `request.user.organization`, not from the URL/host."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=100, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class OrganizationSettings(models.Model):
    """One row per Organization (see `organization` FK below) - branding/
    general config. No longer a true singleton now that Organization exists;
    use OrganizationSettings.load(organization), never .objects.create()
    directly, same "always go through one accessor" precedent as before,
    just parameterized by which org now.
    """

    organization = models.OneToOneField(
        Organization, on_delete=models.CASCADE, primary_key=True, related_name="settings"
    )

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

    # Org-wide kill switch for the first-run interactive product tour
    # (frontend/lib/onboarding/tour.ts) - distinct from a given user having
    # already seen it (accounts.User.preferences.has_completed_tour), which
    # stays per-user even if an admin later re-enables this. Defaults on so
    # existing installs get the tour without an admin opting in.
    product_tour_enabled = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls, organization: Organization) -> "OrganizationSettings":
        # Deliberately NOT defaulting `name` to organization.name - that's
        # the tenant's own registered identity (business/admin purposes),
        # while OrganizationSettings.name is a customizable *display* name
        # that starts at the model field's own default ("Athar") for every
        # org until someone explicitly renames it via organization.manage.
        instance, _ = cls.objects.get_or_create(organization=organization)
        return instance

    def __str__(self):
        return self.name
