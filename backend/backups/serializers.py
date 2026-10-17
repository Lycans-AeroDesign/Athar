from django.conf import settings
from rest_framework import serializers

from .models import BackupJob, RestoreJob


class BackupJobSerializer(serializers.ModelSerializer):
    requested_by = serializers.SlugRelatedField(slug_field="email", read_only=True)
    can_download = serializers.SerializerMethodField()

    class Meta:
        model = BackupJob
        fields = [
            "id",
            "status",
            "requested_by",
            "error",
            "created_at",
            "completed_at",
            "can_download",
        ]

    def get_can_download(self, obj: BackupJob) -> bool:
        return obj.status == BackupJob.Status.DONE and bool(obj.archive)


class RestoreJobSerializer(serializers.ModelSerializer):
    requested_by = serializers.SlugRelatedField(slug_field="email", read_only=True)
    source_backup_id = serializers.PrimaryKeyRelatedField(source="source_backup", read_only=True)

    class Meta:
        model = RestoreJob
        fields = [
            "id",
            "source_backup_id",
            "uploaded_filename",
            "status",
            "requested_by",
            "summary",
            "error",
            "created_at",
            "completed_at",
        ]


class CreateRestoreJobSerializer(serializers.Serializer):
    backup_job_id = serializers.UUIDField()


class DownloadBackupSerializer(serializers.Serializer):
    passphrase = serializers.CharField(
        min_length=settings.BACKUP_PASSPHRASE_MIN_LENGTH, max_length=1024, trim_whitespace=False, write_only=True
    )


class UploadRestoreJobSerializer(serializers.Serializer):
    archive = serializers.FileField()
    # Required for an encrypted (.athar) backup; a plaintext .zip from before
    # backups were encrypted restores without one.
    passphrase = serializers.CharField(
        required=False, allow_blank=True, max_length=1024, trim_whitespace=False, write_only=True
    )
