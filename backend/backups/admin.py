from django.contrib import admin

from .models import BackupJob, RestoreJob


@admin.register(BackupJob)
class BackupJobAdmin(admin.ModelAdmin):
    list_display = ["organization", "status", "requested_by", "created_at", "completed_at"]
    list_filter = ["status"]


@admin.register(RestoreJob)
class RestoreJobAdmin(admin.ModelAdmin):
    list_display = ["organization", "status", "source_backup", "requested_by", "created_at", "completed_at"]
    list_filter = ["status"]
