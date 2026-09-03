from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import paginated_response
from rbac.permissions import require_permission

from . import tasks
from .models import BackupJob, RestoreJob
from .serializers import BackupJobSerializer, CreateRestoreJobSerializer, RestoreJobSerializer

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
        job = get_object_or_404(BackupJob, pk=pk, organization=request.user.organization)
        return Response(BackupJobSerializer(job).data)


class BackupJobDownloadView(APIView):
    permission_classes = [require_permission(BACKUP_PERMISSION)]

    @extend_schema(
        tags=["Backups"],
        summary="Download a finished backup archive",
        responses={200: OpenApiResponse(description="The .zip archive."), 400: OpenApiResponse(description="Not ready yet."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        job = get_object_or_404(BackupJob, pk=pk, organization=request.user.organization)
        if job.status != BackupJob.Status.DONE or not job.archive:
            raise ValidationError("This backup isn't ready yet.")
        return FileResponse(job.archive.open("rb"), filename=f"{job.organization_id}-backup.zip", as_attachment=True)


class RestoreJobListCreateView(APIView):
    """Restores the organization's content from one of its own BackupJobs -
    see backups/restore.py for exactly what "restore" means here (content
    only, full wipe-and-replace at the org scope - not Users/Roles/...).
    Only a backup belonging to the same organization can be used as a
    source (enforced below), so this can never pull another organization's
    data in via a guessed BackupJob id."""

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
        job = get_object_or_404(RestoreJob, pk=pk, organization=request.user.organization)
        return Response(RestoreJobSerializer(job).data)
