from django.conf import settings
from django.db import models

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel


def backup_archive_upload_path(instance: "BackupJob", filename: str) -> str:
    return f"backups/{instance.organization_id}/{instance.id}.zip"


class BackupJob(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """One export of an organization's own data (see backups/services.py's
    build_org_backup_archive) - run as a Celery task (backups/tasks.py) so
    downloading a large org's backup never ties up a request. Gated on
    organization.manage throughout (views.py) - the same permission that
    already uniquely identifies an org admin elsewhere in this app (see
    knowledge/visibility.py's ADMIN_BYPASS_PERMISSION)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Uses whatever STORAGES["default"] is configured (local disk or
    # S3-compatible - see config/settings.py) automatically, same as
    # files.StoredFile.file - no special-casing needed here for that.
    archive = models.FileField(upload_to=backup_archive_upload_path, null=True, blank=True)
    error = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.organization_id} backup ({self.status}) @ {self.created_at:%Y-%m-%d %H:%M}"


class RestoreJob(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Restores an organization's content from one of its own BackupJob
    archives - see backups/restore.py for the actual wipe-and-replace logic
    and exactly what is/isn't restored. Same Celery-task shape as BackupJob
    (backups/tasks.py), same organization.manage gate (views.py)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    # SET_NULL, not CASCADE - deleting the source backup later shouldn't
    # delete the historical record that a restore from it happened.
    source_backup = models.ForeignKey(BackupJob, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # {"created": {"articles": 12, ...}, "orphaned_user_refs": 2, "missing_files": 0} -
    # see restore.RestoreSummary.as_dict().
    summary = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.organization_id} restore ({self.status}) @ {self.created_at:%Y-%m-%d %H:%M}"
