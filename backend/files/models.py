import uuid

from django.conf import settings
from django.db import models


def stored_file_upload_path(instance, filename):
    return f"uploads/{instance.id}/{filename}"


class StoredFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_filename
