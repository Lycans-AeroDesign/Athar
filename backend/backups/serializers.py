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
            "status",
            "requested_by",
            "summary",
            "error",
            "created_at",
            "completed_at",
        ]


class CreateRestoreJobSerializer(serializers.Serializer):
    backup_job_id = serializers.UUIDField()
