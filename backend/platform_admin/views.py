from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import User
from accounts.services import send_password_reset_email
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import DefaultPagination, paginated_response
from organization.models import Organization

from . import services
from .permissions import IsPlatformAdmin
from .serializers import (
    PlatformOrganizationSerializer,
    PlatformPasswordResetRequestSerializer,
    PlatformPasswordResetResultSerializer,
    PlatformSettingsSerializer,
    PlatformSummarySerializer,
    PlatformUserSerializer,
)

TAG = "Platform"

ACTIVE_BODY = {"application/json": {"type": "object", "properties": {"is_active": {"type": "boolean"}}}}


class PlatformView(APIView):
    """Instance operators only. Views here are cross-organization by design, which is why
    they never use request.user.organization or org_object_or_404."""

    permission_classes = [IsPlatformAdmin]


def _require_bool(request) -> bool:
    is_active = request.data.get("is_active")
    if not isinstance(is_active, bool):
        raise ValidationError("is_active must be a boolean.")
    return is_active


class SummaryView(PlatformView):
    @extend_schema(
        tags=[TAG], summary="Instance-wide totals", responses={200: PlatformSummarySerializer, **COMMON_ERRORS}
    )
    def get(self, request):
        return Response(PlatformSummarySerializer(services.instance_summary()).data)


class OrganizationListView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="List every organization with administrative stats (no content)",
        responses={200: PlatformOrganizationSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = Organization.objects.order_by("name")
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(slug__icontains=search))
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            PlatformOrganizationSerializer(services.organization_stats(page), many=True).data
        )


class OrganizationDetailView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="One organization's administrative stats",
        responses={200: PlatformOrganizationSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        organization = get_object_or_404(Organization, pk=pk)
        return Response(PlatformOrganizationSerializer(services.organization_stats([organization])[0]).data)


class OrganizationUsersView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="An organization's user accounts (metadata only)",
        responses={200: PlatformUserSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        organization = get_object_or_404(Organization, pk=pk)
        return paginated_response(request, services.organization_users(organization), PlatformUserSerializer)


class OrganizationActiveView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary='Suspend or reactivate an organization (body: {"is_active": bool})',
        request=ACTIVE_BODY,
        responses={200: PlatformOrganizationSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        organization = get_object_or_404(Organization, pk=pk)
        services.set_organization_active(
            organization=organization, is_active=_require_bool(request), actor=request.user, request=request
        )
        return Response(PlatformOrganizationSerializer(services.organization_stats([organization])[0]).data)


class UserActiveView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary='Block or unblock a user in any organization (body: {"is_active": bool})',
        request=ACTIVE_BODY,
        responses={200: PlatformUserSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        user = services.set_user_active(user=user, is_active=_require_bool(request), actor=request.user, request=request)
        return Response(PlatformUserSerializer(user).data)


class UserPasswordResetLinkView(PlatformView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        tags=[TAG],
        summary="Email a one-time password reset link to a user in any organization (the link is never returned)",
        request=PlatformPasswordResetRequestSerializer,
        responses={201: PlatformPasswordResetResultSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if not settings.EMAIL_ENABLED:
            raise ValidationError("Email isn't configured on this server.")
        options = PlatformPasswordResetRequestSerializer(data=request.data)
        options.is_valid(raise_exception=True)
        link, token = services.issue_password_reset_link(user=user, actor=request.user, request=request)
        email_sent = send_password_reset_email(
            user=user,
            url=f"{options.validated_data['link_base']}#{token}",
            language=options.validated_data["language"],
            actor=request.user,
            request=request,
        )
        return Response(
            PlatformPasswordResetResultSerializer(
                {"expires_at": link.expires_at, "email": user.email, "email_sent": email_sent}
            ).data,
            status=status.HTTP_201_CREATED,
        )


class SettingsView(PlatformView):
    @extend_schema(
        tags=[TAG], summary="Instance-wide switches", responses={200: PlatformSettingsSerializer, **COMMON_ERRORS}
    )
    def get(self, request):
        return Response(PlatformSettingsSerializer(services.get_platform_settings()).data)

    @extend_schema(
        tags=[TAG],
        summary="Open or close public organization signup",
        request=PlatformSettingsSerializer,
        responses={200: PlatformSettingsSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def patch(self, request):
        body = PlatformSettingsSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        result = services.set_organization_registration_enabled(
            enabled=body.validated_data["organization_registration_enabled"], actor=request.user, request=request
        )
        return Response(PlatformSettingsSerializer(result).data)
