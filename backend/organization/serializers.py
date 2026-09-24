from django.conf import settings as django_settings
from rest_framework import serializers

from accounts.models import User, username_validator
from accounts.serializers import check_password_strength, check_unique_username, normalize_unique_email
from files.models import StoredFile
from files.serializers import StoredFileSerializer

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
    # Instance-wide (not per-organization) flag mirrored from settings.py's
    # ENABLE_ORGANIZATION_REGISTRATION, not an OrganizationSettings model
    # field - piggybacks on this always-public, pre-login endpoint so the
    # register page can hide its "create a new organization" tab without a
    # dedicated endpoint. See OrganizationCreateView, which is the one that
    # actually enforces this server-side.
    organization_registration_enabled = serializers.SerializerMethodField()

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
            "organization_registration_enabled",
            "updated_at",
        ]

    def get_logo_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/logo/" if obj.logo else None

    def get_favicon_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/favicon/" if obj.favicon else None

    def get_organization_registration_enabled(self, obj: OrganizationSettings) -> bool:
        return django_settings.ENABLE_ORGANIZATION_REGISTRATION


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
    # Optional, same format/uniqueness rules as accounts.User.username - a
    # plain Serializer, not a ModelSerializer, so DRF's automatic
    # UniqueValidator can't be used here (it assumes the model field is named
    # the same as this serializer field, i.e. "admin_username", which doesn't
    # exist on User - see this field's own uniqueness check below instead).
    # username_validator (format only, no DB lookup) is still skipped by DRF
    # for a blank "" submission (allow_blank=True), so leaving this empty at
    # signup never 400s.
    admin_username = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=30, validators=[username_validator]
    )

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
    class Meta:
        model = OrganizationSettings
        fields = ["name", "product_tour_enabled"]


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
