from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.serializers import UserSerializer
from config.openapi import BAD_REQUEST, COMMON_ERRORS
from rbac.permissions import require_permission

from . import services
from .models import Organization, OrganizationSettings
from .serializers import (
    OrganizationBrandingUpdateSerializer,
    OrganizationCreateSerializer,
    OrganizationGeneralUpdateSerializer,
    OrganizationSettingsSerializer,
)


def _public_organization(request) -> Organization | None:
    """Which org's branding/settings an anonymous (pre-login) request sees.

    There is no subdomain/host-based routing yet (see Organization.slug's
    own docstring), so an anonymous visitor's organization genuinely can't
    be determined - falling back to the oldest organization is a deliberate,
    documented limitation (every tenant's pre-login screen currently shows
    the *first* org's branding, not their own), not a real per-tenant
    resolution. Once authenticated, every other view in this file uses
    request.user.organization instead, which is always correct."""
    if request.user.is_authenticated:
        return request.user.organization
    return Organization.objects.order_by("created_at").first()


class OrganizationSettingsView(APIView):
    """Read-only and fully public (no auth required) - name/branding are
    shown on the pre-login screen too, not just inside the authenticated app.
    See _public_organization() above for the pre-login-only limitation this
    implies now that Organization is no longer a singleton."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Organization"],
        summary="Get the current organization settings (name, branding, ...) - public, no auth required",
        responses={200: OrganizationSettingsSerializer, 404: OpenApiResponse(description="No organization exists yet.")},
    )
    def get(self, request):
        organization = _public_organization(request)
        if organization is None:
            raise Http404
        return Response(OrganizationSettingsSerializer(OrganizationSettings.load(organization)).data)


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
        organization = _public_organization(request)
        if organization is None:
            raise Http404
        settings = OrganizationSettings.load(organization)
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
        organization = _public_organization(request)
        if organization is None:
            raise Http404
        settings = OrganizationSettings.load(organization)
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
        settings = OrganizationSettings.load(request.user.organization)
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
        settings = OrganizationSettings.load(request.user.organization)
        serializer = OrganizationBrandingUpdateSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        settings = services.update_branding(
            settings=settings, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(OrganizationSettingsSerializer(settings).data)


class OrganizationCreateView(APIView):
    """The self-service SaaS signup entrypoint - "create a new organization,"
    distinct from accounts.RegisterView ("join an existing one via an
    invitation code"). Public/AllowAny like RegisterView; also mirrors
    RegisterView's shape by not auto-logging-in the new admin - the frontend
    redirects to /login afterward, same flow as invitation-based registration."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Organization"],
        summary="Create a brand-new organization with its first user as Organization Admin",
        request=OrganizationCreateSerializer,
        responses={201: UserSerializer, 400: BAD_REQUEST},
    )
    def post(self, request):
        serializer = OrganizationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _organization, admin = services.create_organization(request=request, **serializer.validated_data)
        return Response(UserSerializer(admin).data, status=status.HTTP_201_CREATED)
