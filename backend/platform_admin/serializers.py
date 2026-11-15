from rest_framework import serializers

from accounts.models import User
from accounts.serializers import validate_reset_link_base

from .models import ErrorEvent


class ContentCountsSerializer(serializers.Serializer):
    articles = serializers.IntegerField()
    questions = serializers.IntegerField()
    projects = serializers.IntegerField()
    components = serializers.IntegerField()
    failures = serializers.IntegerField()
    sops = serializers.IntegerField()
    tests = serializers.IntegerField()
    documents = serializers.IntegerField()
    courses = serializers.IntegerField()


class PlatformOrganizationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    slug = serializers.CharField()
    is_active = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    user_count = serializers.IntegerField()
    active_user_count = serializers.IntegerField()
    admin_emails = serializers.ListField(child=serializers.EmailField())
    file_count = serializers.IntegerField()
    file_bytes = serializers.IntegerField()
    backup_bytes = serializers.IntegerField()
    total_bytes = serializers.IntegerField()
    last_activity = serializers.DateTimeField(allow_null=True)
    content_counts = ContentCountsSerializer()


class PlatformSummarySerializer(serializers.Serializer):
    organization_count = serializers.IntegerField()
    active_organization_count = serializers.IntegerField()
    user_count = serializers.IntegerField()
    active_user_count = serializers.IntegerField()
    file_bytes = serializers.IntegerField()
    backup_bytes = serializers.IntegerField()
    total_bytes = serializers.IntegerField()
    # Null when uploads live in object storage instead of the VM's disk
    # (services.disk_usage) - the frontend hides the disk card then.
    disk_total_bytes = serializers.IntegerField(allow_null=True)
    disk_used_bytes = serializers.IntegerField(allow_null=True)
    disk_free_bytes = serializers.IntegerField(allow_null=True)
    open_error_count = serializers.IntegerField()


class PlatformUserSerializer(serializers.ModelSerializer):
    """Account metadata only; deliberately a different, narrower shape than accounts' UserSerializer."""

    roles = serializers.SlugRelatedField(many=True, slug_field="name", read_only=True)
    last_activity = serializers.DateTimeField(read_only=True, allow_null=True, default=None)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "roles",
            "is_active",
            "is_superuser",
            "date_joined",
            "last_activity",
        ]
        read_only_fields = fields


class PlatformPasswordResetRequestSerializer(serializers.Serializer):
    """Platform admins can only have the reset link emailed to the user; they never receive the
    token, so a reset can't be used to take over an account and read its organization's content."""

    link_base = serializers.URLField(max_length=500, validators=[validate_reset_link_base])
    language = serializers.ChoiceField(choices=["en", "ar"], default="en")


class PlatformPasswordResetResultSerializer(serializers.Serializer):
    email = serializers.EmailField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
    email_sent = serializers.BooleanField(read_only=True)


class PlatformSettingsSerializer(serializers.Serializer):
    organization_registration_enabled = serializers.BooleanField()


class ErrorEventListSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", default=None, read_only=True)

    class Meta:
        model = ErrorEvent
        fields = [
            "id",
            "source",
            "level",
            "exception_type",
            "message",
            "method",
            "path",
            "count",
            "first_seen",
            "last_seen",
            "resolved_at",
            "organization_name",
        ]
        read_only_fields = fields


class ErrorEventSerializer(ErrorEventListSerializer):
    user_email = serializers.EmailField(source="user.email", default=None, read_only=True)

    class Meta(ErrorEventListSerializer.Meta):
        fields = ErrorEventListSerializer.Meta.fields + ["logger", "traceback", "user_agent", "user_email"]
        read_only_fields = fields


class ErrorReportSerializer(serializers.Serializer):
    """An error the browser caught (frontend lib/errorReporting.ts). Lengths are capped so a
    report can't be used to store arbitrary bulk data."""

    name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    message = serializers.CharField(max_length=4000)
    stack = serializers.CharField(max_length=20_000, required=False, allow_blank=True, default="")
    component_stack = serializers.CharField(max_length=20_000, required=False, allow_blank=True, default="")
    url = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
