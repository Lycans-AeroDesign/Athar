from django.db import transaction
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from files.services import confirm_stored_files
from rbac.services import seed_rbac_for_organization

from .models import Organization, OrganizationSettings

# Leading bytes -> the only Content-Type branding images are ever served
# as (see views.OrganizationLogoView/OrganizationFaviconView). Decided from
# the file's actual content, not its client-supplied filename or MIME type -
# both are whatever the uploader said. SVG is deliberately absent: it's a
# script-capable document, and the logo/favicon URLs are public and served
# inline from the app's own origin, so an SVG there is stored XSS against
# anyone who opens the link.
_BRANDING_IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"\x00\x00\x01\x00", "image/x-icon"),
)


def branding_image_content_type(stored_file) -> str | None:
    """The safe Content-Type for `stored_file` as a logo/favicon, or None if
    its bytes aren't one of the allowed raster formats."""
    with stored_file.file.open("rb") as handle:
        header = handle.read(12)
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    for signature, content_type in _BRANDING_IMAGE_SIGNATURES:
        if header.startswith(signature):
            return content_type
    return None


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
        if value is not None and branding_image_content_type(value) is None:
            raise ValidationError({f"{field}_id": "Use a PNG, JPEG, GIF, WebP or ICO image."})
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    confirm_stored_files(*fields.values())
    log_action(actor=actor, action="branding.update", target=settings, request=request)
    return settings
