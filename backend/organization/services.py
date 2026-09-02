from django.db import transaction
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from rbac.services import seed_rbac_for_organization

from .models import Organization, OrganizationSettings


def _unique_org_slug(name: str) -> str:
    """Same slugify-and-dedupe shape as knowledge/services.py's _unique_slug -
    not shared with it directly since that helper takes a model class from
    the knowledge app; small enough not to be worth a cross-app import for."""
    base = slugify(name)[:90] or "org"
    candidate, suffix = base, 1
    while Organization.objects.filter(slug=candidate).exists():
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


@transaction.atomic
def create_organization(
    *,
    name: str,
    admin_email: str,
    admin_password: str,
    admin_first_name: str = "",
    admin_last_name: str = "",
    admin_username: str | None = None,
    request=None,
):
    """The self-service SaaS signup entrypoint - creates a brand-new,
    fully-isolated Organization plus its first user (assigned that org's own
    Organization Admin role). Distinct from accounts.services.register_user,
    which joins an EXISTING org via an invitation code. Returns (organization,
    admin_user); mirrors RegisterView's own shape (create, don't auto-login -
    the caller still logs in separately, same as invitation-based registration)."""
    from accounts.models import User
    from rbac.models import Role

    organization = Organization.objects.create(name=name, slug=_unique_org_slug(name))
    OrganizationSettings.objects.create(organization=organization, name=name)
    seed_rbac_for_organization(organization)

    admin = User.objects.create_user(
        email=admin_email,
        password=admin_password,
        organization=organization,
        first_name=admin_first_name,
        last_name=admin_last_name,
        username=admin_username,
    )
    admin_role = Role.objects.get(organization=organization, name="Organization Admin")
    admin_role.user_roles.create(user=admin)

    log_action(actor=admin, action="organization.create", target=organization, request=request)
    return organization, admin


def update_general(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="organization.update", target=settings, request=request)
    return settings


def update_branding(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    # logo_id/favicon_id resolve against the global StoredFile.objects.all()
    # queryset at the serializer layer (see OrganizationBrandingUpdateSerializer -
    # a PrimaryKeyRelatedField's queryset can't easily be scoped per-request),
    # so this is the one place that actually stops an org admin from pointing
    # their branding at a file uploaded by a different tenant.
    for field in ("logo", "favicon"):
        value = fields.get(field)
        if value is not None and value.organization_id != settings.organization_id:
            raise ValidationError({f"{field}_id": "That file doesn't belong to your organization."})
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="branding.update", target=settings, request=request)
    return settings
