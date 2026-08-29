from django.conf import settings
from rest_framework import serializers

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

    def validate_file(self, uploaded_file):
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        if uploaded_file.size > max_bytes:
            raise serializers.ValidationError(
                f"File too large ({uploaded_file.size / (1024 * 1024):.1f}MB) - "
                f"the limit is {settings.MAX_UPLOAD_SIZE_MB}MB."
            )
        return uploaded_file
