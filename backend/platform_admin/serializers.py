from rest_framework import serializers

from accounts.models import User


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
