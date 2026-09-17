import logging
import re
from datetime import timedelta

from django.utils import timezone

from audit.services import log_action

from .models import StoredFile

logger = logging.getLogger(__name__)

# A newly uploaded, never-attached file sits unconfirmed for this long before
# the periodic sweep (files/tasks.py:delete_unconfirmed_files) reclaims it -
# long enough that a user mid-edit on a long form isn't punished for taking a
# lunch break, short enough that abandoned uploads don't pile up for good.
UNCONFIRMED_FILE_GRACE_PERIOD = timedelta(hours=24)

# Matches the exact shape StoredFileSerializer.get_download_url emits - see
# files/serializers.py. Used to find files a markdown body embeds by URL
# (MarkdownEditor.tsx's inline image/file upload) rather than by a real FK,
# so confirm_stored_files_in_text can mark those confirmed too.
_DOWNLOAD_URL_RE = re.compile(
    r"/api/v1/files/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/download/"
)


def upload_file(*, uploaded_file, required_permission: str, actor, request=None) -> StoredFile:
    stored_file = StoredFile.objects.create(
        organization=actor.organization,
        file=uploaded_file,
        original_filename=uploaded_file.name,
        content_type=uploaded_file.content_type or "",
        size=uploaded_file.size,
        uploaded_by=actor,
        required_permission=required_permission,
    )
    log_action(actor=actor, action="file.upload", target=stored_file, request=request)
    return stored_file


def delete_file(*, stored_file: StoredFile, actor, request=None) -> None:
    log_action(
        actor=actor,
        action="file.delete",
        metadata={"file_id": str(stored_file.pk), "filename": stored_file.original_filename},
        request=request,
    )
    stored_file.file.delete(save=False)
    stored_file.delete()


def confirm_stored_files(*values) -> None:
    """Marks each StoredFile among `values` as confirmed - i.e. actually
    referenced by something durable, not still a staged upload the cleanup
    sweep should reclaim. Ignores None and non-StoredFile values so callers
    can pass a create/update function's whole fields dict/kwargs through
    without filtering first (e.g. confirm_stored_files(*fields.values()) in a
    generic update_X(*, x, **fields) function). Idempotent."""
    now = timezone.now()
    for value in values:
        if isinstance(value, StoredFile) and value.confirmed_at is None:
            value.confirmed_at = now
            value.save(update_fields=["confirmed_at"])


def confirm_stored_files_in_text(*texts, organization) -> None:
    """Same idea as confirm_stored_files, but for files referenced by URL
    inside a markdown body (MarkdownEditor.tsx's inline upload inserts a
    `download_url` link/image reference, not a real FK) rather than a
    resolved StoredFile object. Scoped to `organization` so a stray id typed
    into text can never confirm (and thus save from the sweep) another org's
    file - matches every other cross-org guard in this app."""
    ids: set[str] = set()
    for text in texts:
        if text:
            ids.update(_DOWNLOAD_URL_RE.findall(text))
    if not ids:
        return
    StoredFile.objects.filter(pk__in=ids, organization=organization, confirmed_at__isnull=True).update(
        confirmed_at=timezone.now()
    )


def delete_unconfirmed_files() -> int:
    """Reclaims storage/DB rows from uploads that were never attached to
    anything - see StoredFile.confirmed_at's docstring. System-triggered (no
    actor), so this skips the log_action audit trail delete_file uses for a
    real user-initiated delete; these were never live in the first place."""
    cutoff = timezone.now() - UNCONFIRMED_FILE_GRACE_PERIOD
    stale = StoredFile.objects.filter(confirmed_at__isnull=True, created_at__lt=cutoff)
    count = 0
    for stored_file in stale:
        stored_file.file.delete(save=False)
        stored_file.delete()
        count += 1
    if count:
        logger.info("delete_unconfirmed_files: reclaimed %d unconfirmed file(s)", count)
    return count
