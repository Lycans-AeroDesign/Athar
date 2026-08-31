from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND, UNAUTHORIZED
from rbac.permissions import require_permission

from . import services
from .models import StoredFile
from .serializers import StoredFileSerializer, StoredFileUploadInputSerializer


class FileUploadView(APIView):
    permission_classes = [require_permission("file.upload")]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=["Files"],
        summary="Upload a file",
        request=StoredFileUploadInputSerializer,
        responses={201: StoredFileSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = StoredFileUploadInputSerializer(data=request.data)
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
        stored_file = get_object_or_404(StoredFile, pk=pk)
        if not request.user.has_permission(stored_file.required_permission):
            raise PermissionDenied("You do not have permission to access this file.")
        # as_attachment=True (Content-Disposition: attachment) rather than
        # inline: the frontend never navigates the browser to this URL
        # directly (see AuthenticatedImage.tsx / lib/api/files.ts's
        # downloadFile() - both fetch the bytes via apiFetch and hand the
        # browser a blob: URL, which ignores this header entirely), so this
        # has no effect on any real feature. It does stop an uploaded
        # .svg/.html file from executing inline if this URL is ever hit by
        # a direct browser navigation instead - defense in depth against a
        # theoretical XSS-via-upload path.
        return FileResponse(
            stored_file.file.open("rb"),
            filename=stored_file.original_filename,
            as_attachment=True,
        )


class FileDeleteView(APIView):
    permission_classes = [require_permission("file.delete")]

    @extend_schema(
        tags=["Files"],
        summary="Delete a file",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        stored_file = get_object_or_404(StoredFile, pk=pk)
        services.delete_file(stored_file=stored_file, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
