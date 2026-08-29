from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS
from rbac.permissions import require_permission

from . import services
from .models import OrganizationSettings
from .serializers import (
    OrganizationBrandingUpdateSerializer,
    OrganizationGeneralUpdateSerializer,
    OrganizationSettingsSerializer,
)


class OrganizationSettingsView(APIView):
    """Read-only and fully public (no auth required) - name/branding are
    shown on the pre-login screen too, not just inside the authenticated app."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Organization"],
        summary="Get the current organization settings (name, branding, ...) - public, no auth required",
        responses={200: OrganizationSettingsSerializer},
    )
    def get(self, request):
        return Response(OrganizationSettingsSerializer(OrganizationSettings.load()).data)


class OrganizationLogoView(APIView):
    """Unlike backend/files/views.py's FileDownloadView, this is deliberately
    public with no auth check at all - the logo has to render on the
    pre-login screen, where there is no access token to send."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Organization"],
        summary="Get the organization logo image - public, no auth required",
        responses={200: OpenApiResponse(description="The logo image."), 404: OpenApiResponse(description="No logo set.")},
    )
    def get(self, request):
        settings = OrganizationSettings.load()
        if not settings.logo:
            raise Http404
        return FileResponse(settings.logo.file.open("rb"), filename=settings.logo.original_filename)


class OrganizationFaviconView(APIView):
    """Public for the same reason as OrganizationLogoView - a browser's own
    favicon fetch (<link rel="icon">) can never carry an Authorization header."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Organization"],
        summary="Get the organization favicon image - public, no auth required",
        responses={200: OpenApiResponse(description="The favicon image."), 404: OpenApiResponse(description="No favicon set.")},
    )
    def get(self, request):
        settings = OrganizationSettings.load()
        if not settings.favicon:
            raise Http404
        return FileResponse(settings.favicon.file.open("rb"), filename=settings.favicon.original_filename)


class OrganizationGeneralUpdateView(APIView):
    permission_classes = [require_permission("organization.manage")]

    @extend_schema(
        tags=["Organization"],
        summary="Update general organization settings",
        request=OrganizationGeneralUpdateSerializer,
        responses={200: OrganizationSettingsSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def patch(self, request):
        settings = OrganizationSettings.load()
        serializer = OrganizationGeneralUpdateSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        settings = services.update_general(
            settings=settings, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(OrganizationSettingsSerializer(settings).data)


class OrganizationBrandingUpdateView(APIView):
    permission_classes = [require_permission("branding.manage")]

    @extend_schema(
        tags=["Organization"],
        summary="Update branding (logo, favicon, theme colors)",
        request=OrganizationBrandingUpdateSerializer,
        responses={200: OrganizationSettingsSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def patch(self, request):
        settings = OrganizationSettings.load()
        serializer = OrganizationBrandingUpdateSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        settings = services.update_branding(
            settings=settings, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(OrganizationSettingsSerializer(settings).data)
