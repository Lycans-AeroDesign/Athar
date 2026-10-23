from django.conf import settings as django_settings
from rest_framework import serializers

from accounts.models import User, username_validator
from accounts.serializers import check_password_strength, check_unique_username, normalize_unique_email
from files.models import StoredFile
from files.serializers import StoredFileSerializer
from platform_admin.models import organization_registration_enabled

from .models import OrganizationSettings


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    # OrganizationSettings' pk is now `organization` (a OneToOneField) rather
    # than its own `id` column (see models.py) - exposed as "id" anyway since
    # every other serializer in this app already returns an "id" field and
    # nothing about the frontend's use of it needs to change.
    id = serializers.UUIDField(source="organization_id", read_only=True)
    logo = StoredFileSerializer(read_only=True)
    favicon = StoredFileSerializer(read_only=True)
    # Always-public URLs (see OrganizationLogoView/OrganizationFaviconView) -
    # use these to actually render the image (sidebar, login screen, browser
    # favicon); `logo`/`favicon` above are the auth-gated StoredFile detail,
    # useful for the settings form's own bookkeeping (filename, id, ...).
    logo_url = serializers.SerializerMethodField()
    favicon_url = serializers.SerializerMethodField()
    # Instance-wide flag (platform operator toggle, else settings.ENABLE_ORGANIZATION_REGISTRATION), carried on
    # this public pre-login endpoint so the register page can hide its "create organization"
    # tab. OrganizationCreateView enforces it server-side.
    organization_registration_enabled = serializers.SerializerMethodField()
    # Same idea, mirrors settings.EMAIL_ENABLED - lets the Users tab offer
    # "email the reset link" only when the server can actually send email.
    email_enabled = serializers.SerializerMethodField()
    # The org's own upload limit override (None = platform default), plus the
    # limit actually in force right now - upload hint texts and the Settings
    # form both want the *effective* number, serialization-wide.
    max_upload_size_mb = serializers.IntegerField(read_only=True)
    effective_max_upload_size_mb = serializers.SerializerMethodField()
    # Exposed so the Settings form can cap the input without hardcoding a
    # value that the deployment may have raised via
    # MAX_ORG_UPLOAD_SIZE_CEILING_MB (settings.py).
    max_upload_size_ceiling = serializers.SerializerMethodField()
    # The platform-wide default the org falls back to when its own override is
    # null - the Settings form's "empty = server default" hint needs it.
    max_upload_size_platform_default = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationSettings
        fields = [
            "id",
            "name",
            "logo",
            "favicon",
            "logo_url",
            "favicon_url",
            "primary_color",
            "secondary_color",
            "primary_color_dark",
            "secondary_color_dark",
            "product_tour_enabled",
            "max_upload_size_mb",
            "effective_max_upload_size_mb",
            "max_upload_size_ceiling",
            "max_upload_size_platform_default",
            "organization_registration_enabled",
            "email_enabled",
            "updated_at",
        ]

    def get_logo_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/logo/" if obj.logo else None

    def get_favicon_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/favicon/" if obj.favicon else None

    def get_organization_registration_enabled(self, obj: OrganizationSettings) -> bool:
        return organization_registration_enabled()

    def get_email_enabled(self, obj: OrganizationSettings) -> bool:
        return django_settings.EMAIL_ENABLED

    def get_effective_max_upload_size_mb(self, obj: OrganizationSettings) -> int:
        from .services import effective_max_upload_size_mb

        return effective_max_upload_size_mb(obj.organization)

    def get_max_upload_size_ceiling(self, obj: OrganizationSettings) -> int:
        return django_settings.MAX_ORG_UPLOAD_SIZE_CEILING_MB

    def get_max_upload_size_platform_default(self, obj: OrganizationSettings) -> int:
        return django_settings.MAX_UPLOAD_SIZE_MB


class OrganizationCreateSerializer(serializers.Serializer):
    """Validation only for the self-service "create a new organization" signup
    flow - services.create_organization() does the actual creation. Distinct
    from accounts.serializers.RegisterSerializer, which joins an EXISTING org
    via an invitation code rather than creating one."""

    name = serializers.CharField(max_length=200)
    admin_email = serializers.EmailField()
    admin_password = serializers.CharField(write_only=True, min_length=8)
    admin_first_name = serializers.CharField(required=False, allow_blank=True, default="")
    admin_last_name = serializers.CharField(required=False, allow_blank=True, default="")
    # Required; same format/uniqueness rules as accounts.User.username. A plain Serializer, so
    # DRF's UniqueValidator doesn't apply (no `admin_username` on User); see the uniqueness
    # check below.
    admin_username = serializers.CharField(max_length=30, validators=[username_validator])

    def validate_admin_email(self, value):
        # A plain Serializer (see the admin_username field's own comment
        # above for why) gets none of ModelSerializer's automatic
        # UniqueValidator machinery - and that one is case-sensitive anyway,
        # which is exactly the gap normalize_unique_email closes.
        return normalize_unique_email(value)

    def validate_admin_username(self, value):
        return check_unique_username(value)

    def validate(self, attrs):
        check_password_strength(
            attrs["admin_password"],
            user=User(
                email=attrs.get("admin_email", ""),
                username=attrs.get("admin_username"),
                first_name=attrs.get("admin_first_name", ""),
                last_name=attrs.get("admin_last_name", ""),
            ),
            field="admin_password",
        )
        return attrs


class OrganizationGeneralUpdateSerializer(serializers.ModelSerializer):
    max_upload_size_mb = serializers.IntegerField(allow_null=True, required=False, min_value=1)

    class Meta:
        model = OrganizationSettings
        fields = ["name", "product_tour_enabled", "max_upload_size_mb"]

    def validate_max_upload_size_mb(self, value):
        # None here means an explicit clean (the request body sent
        # "max_upload_size_mb": null) - reset to the platform default rather
        # than keeping any override.
        if value is None:
            return value
        from django.conf import settings as django_settings

        ceiling = django_settings.MAX_ORG_UPLOAD_SIZE_CEILING_MB
        if value > ceiling:
            raise serializers.ValidationError(
                f"The upload limit can't exceed {ceiling}MB (raise the deployment's "
                f"MAX_ORG_UPLOAD_SIZE_CEILING_MB and nginx's client_max_body_size to go higher)."
            )
        return value


class OrganizationBrandingUpdateSerializer(serializers.ModelSerializer):
    logo_id = serializers.PrimaryKeyRelatedField(
        source="logo", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )
    favicon_id = serializers.PrimaryKeyRelatedField(
        source="favicon", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = OrganizationSettings
        fields = [
            "logo_id",
            "favicon_id",
            "primary_color",
            "secondary_color",
            "primary_color_dark",
            "secondary_color_dark",
        ]
