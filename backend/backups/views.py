import tempfile
import zipfile
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.http import StreamingHttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.services import log_action
from core import crypto
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from core.shortcuts import org_object_or_404
from organization.models import Organization
from config.pagination import paginated_response
from rbac.permissions import require_permission

from . import restore, tasks
from .models import BackupJob, RestoreJob
from .serializers import (
    BackupJobSerializer,
    CreateRestoreJobSerializer,
    DownloadBackupSerializer,
    RestoreJobSerializer,
    UploadRestoreJobSerializer,
)

# organization.manage - the same permission knowledge/visibility.py's
# ADMIN_BYPASS_PERMISSION uses as the "is this an org admin" signal - is
# reused here rather than a new codename, since "who can back up this org's
# data" is exactly the same question as "who administers this org".
BACKUP_PERMISSION = "organization.manage"


class BackupJobListCreateView(APIView):
    permission_classes = [require_permission(BACKUP_PERMISSION)]

    @extend_schema(
        tags=["Backups"],
        summary="List the organization's backup jobs, most recent first",
        responses={200: BackupJobSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = BackupJob.objects.filter(organization=request.user.organization)
        return paginated_response(request, queryset, BackupJobSerializer)

    @extend_schema(
        tags=["Backups"],
        summary="Start a new backup of the organization's data and files (runs in the background)",
        responses={201: BackupJobSerializer, **COMMON_ERRORS},
    )
    def post(self, request):
        job = BackupJob.objects.create(organization=request.user.organization, requested_by=request.user)
        tasks.generate_org_backup.delay(str(job.id))
        return Response(BackupJobSerializer(job).data, status=status.HTTP_201_CREATED)


class BackupJobDetailView(APIView):
    permission_classes = [require_permission(BACKUP_PERMISSION)]

    @extend_schema(
        tags=["Backups"],
        summary="Get a backup job's status",
        responses={200: BackupJobSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        job = org_object_or_404(request, BackupJob, pk)
        return Response(BackupJobSerializer(job).data)


@method_decorator(sensitive_post_parameters("passphrase"), name="dispatch")
class BackupJobDownloadView(APIView):
    """POST, not GET, so the passphrase travels in the request body and never
    in a URL (which ends up in nginx/browser history). The stored archive is
    server-key encrypted; this streams it back re-encrypted with the admin's
    passphrase instead, so the downloaded file can be restored on any server
    given only that passphrase (see RestoreJobUploadView). Throttled on its
    own scope: a download is a full export of the organization, so a stolen
    admin token shouldn't be able to pull it repeatedly."""

    permission_classes = [require_permission(BACKUP_PERMISSION)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "backup_download"

    @extend_schema(
        tags=["Backups"],
        summary="Download a finished backup archive, encrypted with the given passphrase",
        request=DownloadBackupSerializer,
        responses={200: OpenApiResponse(description="The encrypted .athar archive."), 400: OpenApiResponse(description="Not ready yet, or passphrase too short."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        job = org_object_or_404(request, BackupJob, pk)
        if job.status != BackupJob.Status.DONE or not job.archive:
            raise ValidationError("This backup isn't ready yet.")
        serializer = DownloadBackupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        passphrase = serializer.validated_data["passphrase"]

        def stream():
            with job.archive.open("rb") as stored:
                # Archives from before at-rest encryption are plaintext.
                plaintext = crypto.iter_decrypt(stored) if crypto.is_encrypted(stored) else crypto.iter_file(stored)
                yield from crypto.iter_encrypt(plaintext, passphrase)

        # Re-encrypting the same plaintext with the same chunking yields exactly the stored
        # file's size. Declaring Content-Length matters: without it some proxies (e.g. Docker
        # Desktop port forwarding) reset the connection and Chrome reports a failed fetch even
        # though every byte arrived.
        with job.archive.open("rb") as stored:
            stored_encrypted = crypto.is_encrypted(stored)
        size = job.archive.size if stored_encrypted else crypto.encrypted_size(job.archive.size)

        log_action(request.user, "backup.download", target=job, request=request)
        response = StreamingHttpResponse(stream(), content_type="application/octet-stream")
        response["Content-Length"] = str(size)
        # Deliberately no Content-Disposition: attachment - this is fetched
        # by JS (Bearer auth, see lib/api/backups.ts, which names the file
        # itself), and download-manager browser extensions hijack any
        # response marked as an attachment, aborting the page's own fetch.
        return response


class RestoreJobListCreateView(APIView):
    """Restores the organization from one of its own BackupJobs - see
    backups/restore.py for exactly what "restore" means here (a full
    wipe-and-replace at the org scope). Only a backup belonging to the same
    organization can be used as a source (enforced below), so this can never
    pull another organization's data in via a guessed BackupJob id."""

    permission_classes = [require_permission(BACKUP_PERMISSION)]

    @extend_schema(
        tags=["Backups"],
        summary="List the organization's restore jobs, most recent first",
        responses={200: RestoreJobSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = RestoreJob.objects.filter(organization=request.user.organization)
        return paginated_response(request, queryset, RestoreJobSerializer)

    @extend_schema(
        tags=["Backups"],
        summary="Restore the organization's content from one of its own backups (runs in the background)",
        request=CreateRestoreJobSerializer,
        responses={201: RestoreJobSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CreateRestoreJobSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        backup_job = get_object_or_404(
            BackupJob,
            pk=serializer.validated_data["backup_job_id"],
            organization=request.user.organization,
            status=BackupJob.Status.DONE,
        )
        job = RestoreJob.objects.create(
            organization=request.user.organization, source_backup=backup_job, requested_by=request.user
        )
        log_action(request.user, "backup.restore", target=job, metadata={"source_backup": str(backup_job.id)}, request=request)
        tasks.restore_org_backup.delay(str(job.id))
        return Response(RestoreJobSerializer(job).data, status=status.HTTP_201_CREATED)


def _validate_archive_contents(archive_file, organization) -> None:
    """Cheap up-front checks on the (decrypted) archive so an obviously wrong
    upload fails here, with a clear message, instead of minutes later in the
    background task. The archive is still treated as untrusted by restore.py
    itself - this isn't what keeps a crafted archive in bounds, that is."""
    max_bytes = settings.BACKUP_UPLOAD_MAX_SIZE_MB * 1024 * 1024
    if not zipfile.is_zipfile(archive_file):
        raise ValidationError({"archive": ["This isn't an Athar backup file."]})
    archive_file.seek(0)
    with zipfile.ZipFile(archive_file) as zf:
        names = set(zf.namelist())
        # Zip-bomb guard: a real backup barely compresses (most of its bulk
        # is already-compressed uploads), so 10x the upload cap is generous.
        if sum(info.file_size for info in zf.infolist()) > max_bytes * 10:
            raise ValidationError({"archive": ["This archive expands to an unreasonable size."]})
        if not names & {"manifest.json", "users.csv", "articles.csv"}:
            raise ValidationError({"archive": ["This doesn't look like an Athar backup."]})
        try:
            manifest = restore.read_manifest(zf)
        except restore.RestoreError as exc:
            raise ValidationError({"archive": [str(exc)]}) from exc
    archive_file.seek(0)
    # A backup of a *different* organization that still exists on this
    # server can't be restored here: its rows' ids are still in use by that
    # organization. (One whose organization is gone - the disaster-recovery
    # case of a fresh server - is fine.)
    source_id = manifest.get("organization_id")
    if source_id and source_id != str(organization.id) and Organization.objects.filter(id=source_id).exists():
        raise ValidationError({"archive": ["This backup belongs to another organization on this server."]})


@method_decorator(sensitive_post_parameters("passphrase"), name="dispatch")
class RestoreJobUploadView(APIView):
    """Restores the organization from an uploaded backup archive - for when
    the server-side copy is gone (e.g. a fresh server after losing the old
    one). Same restore as RestoreJobListCreateView; the archive is kept only
    until the restore finishes (see tasks.restore_org_backup)."""

    permission_classes = [require_permission(BACKUP_PERMISSION)]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=["Backups"],
        summary="Restore the organization from an uploaded backup file (runs in the background)",
        request={"multipart/form-data": UploadRestoreJobSerializer},
        responses={201: RestoreJobSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = UploadRestoreJobSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded_file = serializer.validated_data["archive"]
        passphrase = serializer.validated_data.get("passphrase") or None
        if uploaded_file.size > settings.BACKUP_UPLOAD_MAX_SIZE_MB * 1024 * 1024:
            raise ValidationError({"archive": [f"This file is too large - the limit is {settings.BACKUP_UPLOAD_MAX_SIZE_MB}MB."]})
        job = RestoreJob(
            organization=request.user.organization,
            requested_by=request.user,
            uploaded_filename=uploaded_file.name[:255],
        )
        # Decrypted here, in the request, rather than in the Celery task, so
        # the passphrase never has to pass through the broker - and so a
        # wrong passphrase is reported straight away. What's stored until the
        # task runs is re-encrypted with the server key.
        with tempfile.TemporaryDirectory() as tmp_dir:
            if crypto.is_encrypted(uploaded_file):
                plaintext_path = Path(tmp_dir) / "archive.zip"
                try:
                    crypto.verify_passphrase(uploaded_file, passphrase)
                    with open(plaintext_path, "wb") as plaintext:
                        crypto.decrypt_file(uploaded_file, plaintext, passphrase)
                except crypto.DecryptionError as exc:
                    raise ValidationError({"passphrase": [str(exc)]}) from exc
                archive_file = open(plaintext_path, "rb")
            else:
                # A plaintext .zip downloaded before backups were encrypted.
                archive_file = uploaded_file
            try:
                _validate_archive_contents(archive_file, request.user.organization)
                encrypted_path = Path(tmp_dir) / "archive.zip.enc"
                with open(encrypted_path, "wb") as encrypted:
                    crypto.encrypt_file(archive_file, encrypted)
            finally:
                if archive_file is not uploaded_file:
                    archive_file.close()
            with open(encrypted_path, "rb") as encrypted:
                job.uploaded_archive.save(f"{job.id}.zip.enc", File(encrypted), save=False)
        job.save()
        log_action(request.user, "backup.restore", target=job, metadata={"uploaded_filename": job.uploaded_filename}, request=request)
        tasks.restore_org_backup.delay(str(job.id))
        return Response(RestoreJobSerializer(job).data, status=status.HTTP_201_CREATED)


class RestoreJobDetailView(APIView):
    permission_classes = [require_permission(BACKUP_PERMISSION)]

    @extend_schema(
        tags=["Backups"],
        summary="Get a restore job's status and summary",
        responses={200: RestoreJobSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        job = org_object_or_404(request, RestoreJob, pk)
        return Response(RestoreJobSerializer(job).data)
