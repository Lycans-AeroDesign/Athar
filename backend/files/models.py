import uuid

from django.conf import settings
from django.db import models


def stored_file_upload_path(instance, filename):
    return f"uploads/{instance.id}/{filename}"


class StoredFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    # Null until something durable actually references this file (an owning
    # model's FK, an attachment row, or a markdown body's embedded download
    # link - see services.confirm_stored_files/confirm_stored_files_in_text,
    # called from every create/update path that can receive one). Uploading
    # only stages the file for preview - the two-phase "upload, then save the
    # form that references it" pattern every editor uses (see e.g.
    # ComponentEditor.tsx) means a browser tab closed mid-edit, or an upload
    # the user discards before saving, would otherwise leak forever. The
    # `delete_unconfirmed_files` periodic task (files/tasks.py) reclaims any
    # row still null past a grace period - this field is that staging flag,
    # not a moderation/visibility concept.
    confirmed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_filename
