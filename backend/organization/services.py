from django.db import transaction
from django.utils.text import slugify
from django.conf import settings
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from files.services import confirm_stored_files
from rbac.services import seed_rbac_for_organization

from .models import Organization, OrganizationSettings

# Leading bytes -> the only Content-Type branding images are served as (views.OrganizationLogoView/
# OrganizationFaviconView), decided from file content, not the client-supplied name or MIME
# type. SVG is deliberately absent: it's script-capable and these URLs are public and served
# inline from the app's origin, so it would be stored XSS.
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
    """The self-service signup entrypoint: creates a new, isolated Organization plus its first
    user (assigned that org's own Organization Admin role). Unlike
    accounts.services.register_user, which joins an existing org by invitation code. Returns
    (organization, admin_user); like RegisterView, it doesn't auto-login."""
    from accounts.models import User
    from policies.services import seed_default_policies
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
    # Starter Privacy Policy + Confidentiality Agreement - every member,
    # including this admin, accepts them on first sign-in; the admin can
    # edit and republish them from Settings > Policies.
    seed_default_policies(organization, published_by=admin)

    log_action(actor=admin, action="organization.create", target=organization, request=request)
    return organization, admin


def update_general(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    for field, value in fields.items():
        setattr(settings, field, value)
    settings.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="organization.update", target=settings, request=request)
    return settings


def effective_max_upload_size_mb(organization) -> int:
    """Upload limit (MB) in force for `organization` on the generic upload
    endpoint: its own per-org setting (OrganizationSettings.max_upload_size_mb,
    changed from Settings > Identity), else the platform default
    (config.settings.MAX_UPLOAD_SIZE_MB). Imported lazily by files
    (serializers/views) - organization.services already imports files.services
    at module level, so a top-level import the other way would be circular."""
    return OrganizationSettings.load(organization).max_upload_size_mb or settings.MAX_UPLOAD_SIZE_MB


def update_branding(*, settings: OrganizationSettings, actor, request=None, **fields) -> OrganizationSettings:
    # logo_id/favicon_id resolve against the global StoredFile queryset at the serializer
    # layer, so this is what stops an org admin pointing branding at another tenant's file.
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
