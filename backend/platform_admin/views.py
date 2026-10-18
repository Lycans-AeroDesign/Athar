from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import User
from accounts.serializers import PasswordResetLinkCreateSerializer, PasswordResetLinkSerializer
from accounts.services import send_password_reset_email
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import DefaultPagination, paginated_response
from organization.models import Organization

from . import services
from .permissions import IsPlatformAdmin
from .serializers import PlatformOrganizationSerializer, PlatformSummarySerializer, PlatformUserSerializer

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
        summary="Generate a one-time password reset link for a user in any organization",
        request=PasswordResetLinkCreateSerializer,
        responses={201: PasswordResetLinkSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        options = PasswordResetLinkCreateSerializer(data=request.data)
        options.is_valid(raise_exception=True)
        link, token = services.issue_password_reset_link(user=user, actor=request.user, request=request)
        email_sent = False
        if options.validated_data["send_email"]:
            email_sent = send_password_reset_email(
                user=user,
                url=f"{options.validated_data['link_base']}#{token}",
                language=options.validated_data["language"],
                actor=request.user,
                request=request,
            )
        return Response(
            PasswordResetLinkSerializer(
                {"token": token, "expires_at": link.expires_at, "email": user.email, "email_sent": email_sent}
            ).data,
            status=status.HTTP_201_CREATED,
        )
