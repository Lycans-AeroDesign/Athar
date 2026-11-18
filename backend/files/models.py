import uuid

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


def stored_file_upload_path(instance, filename):
    return f"uploads/{instance.id}/{filename}"


class StoredFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    file = models.FileField(upload_to=stored_file_upload_path)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_files",
    )
    # Codename (e.g. "file.read") a caller must hold to download this file.
    # Swappable for a real object-level visibility model later without migrating this away.
    required_permission = models.CharField(max_length=100, default="file.read")
    created_at = models.DateTimeField(auto_now_add=True)
    # Null until something durable references this file (an owning FK, an attachment row,
    # or a markdown body's embedded download link - see services.confirm_stored_files and
    # confirm_stored_files_in_text). Uploads are staged first (the upload-then-save pattern
    # every editor uses), so a discarded upload would otherwise leak; the periodic
    # `delete_unconfirmed_files` task (files/tasks.py) reclaims rows still null past a grace
    # period. A staging flag, not a moderation/visibility concept.
    confirmed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # files.tasks.delete_unconfirmed_files: unconfirmed rows past the grace period.
            models.Index(
                fields=["created_at"], condition=models.Q(confirmed_at__isnull=True), name="files_unconfirmed_created"
            ),
        ]

    def __str__(self):
        return self.original_filename


@receiver(post_delete, sender=StoredFile)
def _delete_thumbnails(sender, instance, **kwargs):
    # Every path that deletes a StoredFile (files.services.delete_file, the
    # unconfirmed-file sweep, account deletion, ...) goes through here, so
    # none of them can leave its generated thumbnails behind. If the delete is
    # later rolled back, the thumbnails are just regenerated on next request.
    from .thumbnails import delete_thumbnails

    delete_thumbnails(instance)
