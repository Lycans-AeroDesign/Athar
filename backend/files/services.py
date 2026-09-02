from audit.services import log_action

from .models import StoredFile


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
