from django.http import FileResponse
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND, UNAUTHORIZED
from core.shortcuts import org_object_or_404
from rbac.permissions import require_permission

from . import services
from .models import StoredFile
from .serializers import StoredFileSerializer, StoredFileUploadInputSerializer


class FileUploadView(APIView):
    permission_classes = [require_permission("file.upload")]
    parser_classes = [MultiPartParser, FormParser]

    def _early_size_rejection(self, request) -> Response | None:
        """Rejected-before-parsing counterpart of the serializer's exact
        per-file check: without this, Django buffers and spools the whole
        multipart body to a temp file *before* the serializer ever sees it,
        so an oversized upload ran to 100% on the client's progress bar and
        only then failed (see DRF's lazy parser). Content-Length includes the
        multipart framing, so a small margin keeps a legit file just under
        the limit from being bounced here; the exact check still runs later.
        Returns None (keep going) or a 413 Response."""
        from organization.services import effective_max_upload_size_mb

        content_length = request.META.get("CONTENT_LENGTH", "")
        if not content_length.isdigit():
            return None  # chunked or unknown - the exact check is the boundary
        limit_mb = effective_max_upload_size_mb(request.user.organization)
        margin = 64 * 1024
        if int(content_length) > limit_mb * 1024 * 1024 + margin:
            return Response(
                {"detail": f"File too large - the limit is {limit_mb}MB."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        return None

    @extend_schema(
        tags=["Files"],
        summary="Upload a file",
        request=StoredFileUploadInputSerializer,
        responses={201: StoredFileSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        early = self._early_size_rejection(request)
        if early is not None:
            return early
        serializer = StoredFileUploadInputSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        stored_file = services.upload_file(
            uploaded_file=serializer.validated_data["file"],
            required_permission=serializer.validated_data["required_permission"],
            actor=request.user,
            request=request,
        )
        return Response(StoredFileSerializer(stored_file).data, status=status.HTTP_201_CREATED)


class FileDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Files"],
        summary="Download a file (gated by the file's required_permission, not static serving)",
        responses={
            200: OpenApiResponse(description="The file contents."),
            401: UNAUTHORIZED,
            403: OpenApiResponse(description="Missing the file's required_permission."),
            404: NOT_FOUND,
        },
    )
    def get(self, request, pk):
        # organization filter is defense in depth beyond required_permission
        # (Section 11 of the multi-tenancy plan) - required_permission alone
        # says nothing about *which org's* file.read grants access to.
        stored_file = org_object_or_404(request, StoredFile, pk)
        if not request.user.has_permission(stored_file.required_permission):
            raise PermissionDenied("You do not have permission to access this file.")
        # Imported here, not at module level: knowledge already depends on
        # files (its attachment models FK to StoredFile), so a top-level
        # import the other way would be circular.
        from knowledge.visibility import can_view_file

        if not can_view_file(request.user, stored_file):
            raise PermissionDenied("This file belongs to content that isn't accessible to you.")
        # as_attachment=True: the frontend fetches bytes via apiFetch and uses blob: URLs, which
        # ignore this header. It stops an uploaded .svg/.html from executing inline if this URL
        # is ever navigated to directly (defense in depth against XSS-via-upload).
        response = FileResponse(
            stored_file.file.open("rb"),
            filename=stored_file.original_filename,
            as_attachment=True,
        )
        response["Cache-Control"] = "private, max-age=86400, stale-while-revalidate=604800"
        return response


class FileDeleteView(APIView):
    permission_classes = [require_permission("file.delete")]

    @extend_schema(
        tags=["Files"],
        summary="Delete a file",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        stored_file = org_object_or_404(request, StoredFile, pk)
        services.delete_file(stored_file=stored_file, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
