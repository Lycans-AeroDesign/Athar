from rest_framework import serializers

from files.models import StoredFile
from files.serializers import StoredFileSerializer

from .models import OrganizationSettings


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    logo = StoredFileSerializer(read_only=True)
    favicon = StoredFileSerializer(read_only=True)
    # Always-public URLs (see OrganizationLogoView/OrganizationFaviconView) -
    # use these to actually render the image (sidebar, login screen, browser
    # favicon); `logo`/`favicon` above are the auth-gated StoredFile detail,
    # useful for the settings form's own bookkeeping (filename, id, ...).
    logo_url = serializers.SerializerMethodField()
    favicon_url = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationSettings
        fields = [
            "id",
            "name",
            "primary_domain",
            "logo",
            "favicon",
            "logo_url",
            "favicon_url",
            "primary_color",
            "secondary_color",
            "primary_color_dark",
            "secondary_color_dark",
            "updated_at",
        ]

    def get_logo_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/logo/" if obj.logo else None

    def get_favicon_url(self, obj: OrganizationSettings) -> str | None:
        return "/api/v1/organization/settings/favicon/" if obj.favicon else None


class OrganizationGeneralUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationSettings
        fields = ["name", "primary_domain"]


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
