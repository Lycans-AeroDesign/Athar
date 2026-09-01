from django.conf import settings
from rest_framework import serializers

from rbac.models import Permission

from .models import StoredFile


class StoredFileSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = StoredFile
        fields = [
            "id",
            "original_filename",
            "content_type",
            "size",
            "uploaded_by",
            "required_permission",
            "download_url",
            "created_at",
        ]
        read_only_fields = fields

    def get_download_url(self, obj: StoredFile) -> str:
        return f"/api/v1/files/{obj.id}/download/"


class StoredFileUploadInputSerializer(serializers.Serializer):
    file = serializers.FileField()
    required_permission = serializers.CharField(default="file.read")

    def validate_required_permission(self, codename: str) -> str:
        # Fails loud on a typo'd/nonexistent codename instead of silently
        # accepting it - has_permission(codename) against a codename with no
        # matching Permission row just always returns False, which would
        # otherwise lock the file forever with no error telling the uploader why.
        if not Permission.objects.filter(codename=codename).exists():
            raise serializers.ValidationError(f"'{codename}' isn't a known permission codename.")
        return codename

    def validate_file(self, uploaded_file):
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        if uploaded_file.size > max_bytes:
            raise serializers.ValidationError(
                f"File too large ({uploaded_file.size / (1024 * 1024):.1f}MB) - "
                f"the limit is {settings.MAX_UPLOAD_SIZE_MB}MB."
            )
        return uploaded_file
