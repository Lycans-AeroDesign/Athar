from dataclasses import asdict
from urllib.parse import urlsplit

from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import User
from accounts.services import send_password_reset_email
from billing import services as billing_services
from billing.models import Subscription
from billing.services import evaluate
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import DefaultPagination, paginated_response
from organization.models import Organization

from . import services
from .error_log import record_error
from .models import ErrorEvent
from .permissions import IsPlatformAdmin
from .serializers import (
    ErrorEventListSerializer,
    ErrorEventSerializer,
    ErrorReportSerializer,
    PlatformOrganizationSerializer,
    PlatformPasswordResetRequestSerializer,
    PlatformPasswordResetResultSerializer,
    PlatformSettingsSerializer,
    PlatformSubscriptionSerializer,
    PlatformSummarySerializer,
    PlatformUserSerializer,
    RecordPaymentSerializer,
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
        user = services.set_user_active(
            user=user, is_active=_require_bool(request), actor=request.user, request=request
        )
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
        summary="Change instance-wide switches (org signup, subscriptions and their price); only sent fields change",
        request=PlatformSettingsSerializer,
        responses={200: PlatformSettingsSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def patch(self, request):
        body = PlatformSettingsSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if not body.validated_data:
            raise ValidationError("Send at least one setting to change.")
        result = services.update_platform_settings(changes=body.validated_data, actor=request.user, request=request)
        return Response(PlatformSettingsSerializer(result).data)


def _subscription_response(organization) -> Response:
    """The serializer's derived fields (status, access_until, ...) are set on the instance from
    billing.services.evaluate. A missing row is created as exempt, matching how it's treated."""
    subscription, _ = Subscription.objects.get_or_create(organization=organization, defaults={"exempt": True})
    for field, value in (asdict(evaluate(subscription)) | billing_services.usage(organization)).items():
        setattr(subscription, field, value)
    return Response(PlatformSubscriptionSerializer(subscription).data)


class OrganizationSubscriptionView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="An organization's subscription status and payment history",
        responses={200: PlatformSubscriptionSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        return _subscription_response(get_object_or_404(Organization, pk=pk))

    @extend_schema(
        tags=[TAG],
        summary="Manually adjust an organization's subscription (exempt, trial end, paid-until, notes, limits)",
        request=PlatformSubscriptionSerializer,
        responses={200: PlatformSubscriptionSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        organization = get_object_or_404(Organization, pk=pk)
        body = PlatformSubscriptionSerializer(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        if not body.validated_data:
            raise ValidationError("Send at least one field to change.")
        billing_services.update_subscription(
            organization=organization, changes=body.validated_data, actor=request.user, request=request
        )
        return _subscription_response(organization)


class OrganizationPaymentView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="Record an annual payment: extends the organization's access by one year",
        request=RecordPaymentSerializer,
        responses={201: PlatformSubscriptionSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        organization = get_object_or_404(Organization, pk=pk)
        body = RecordPaymentSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        billing_services.record_payment(
            organization=organization, **body.validated_data, actor=request.user, request=request
        )
        response = _subscription_response(organization)
        response.status_code = status.HTTP_201_CREATED
        return response


class ErrorListView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="Recorded backend and frontend errors, most recently seen first",
        parameters=[
            OpenApiParameter("source", str, enum=["backend", "frontend"]),
            OpenApiParameter("status", str, enum=["open", "resolved", "all"], description="Default: open"),
            OpenApiParameter("search", str, description="Matches the message, exception type or path"),
        ],
        responses={200: ErrorEventListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = ErrorEvent.objects.select_related("organization")
        source = request.query_params.get("source", "")
        if source in ErrorEvent.Source.values:
            queryset = queryset.filter(source=source)
        error_status = request.query_params.get("status", "open")
        if error_status == "open":
            queryset = queryset.filter(resolved_at__isnull=True)
        elif error_status == "resolved":
            queryset = queryset.filter(resolved_at__isnull=False)
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(message__icontains=search) | Q(exception_type__icontains=search) | Q(path__icontains=search)
            )
        return paginated_response(request, queryset, ErrorEventListSerializer)


class ErrorDetailView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary="One recorded error with its traceback",
        responses={200: ErrorEventSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        event = get_object_or_404(ErrorEvent.objects.select_related("organization", "user"), pk=pk)
        return Response(ErrorEventSerializer(event).data)

    @extend_schema(
        tags=[TAG], summary="Delete a recorded error", responses={204: None, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def delete(self, request, pk):
        get_object_or_404(ErrorEvent, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ErrorResolvedView(PlatformView):
    @extend_schema(
        tags=[TAG],
        summary='Mark an error resolved or reopen it (body: {"is_resolved": bool})',
        request={"application/json": {"type": "object", "properties": {"is_resolved": {"type": "boolean"}}}},
        responses={200: ErrorEventSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        is_resolved = request.data.get("is_resolved")
        if not isinstance(is_resolved, bool):
            raise ValidationError("is_resolved must be a boolean.")
        event = get_object_or_404(ErrorEvent.objects.select_related("organization", "user"), pk=pk)
        event.resolved_at = timezone.now() if is_resolved else None
        event.save(update_fields=["resolved_at"])
        return Response(ErrorEventSerializer(event).data)


class ErrorReportView(APIView):
    """Where the browser sends errors it caught. Open to signed-out visitors too (a crash on
    the login page is still a bug), so it's throttled and every field is length-capped."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "error_report"

    @extend_schema(
        tags=[TAG],
        summary="Report an error caught in the browser",
        request=ErrorReportSerializer,
        responses={204: None, 400: BAD_REQUEST},
    )
    def post(self, request):
        body = ErrorReportSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        traceback = data["stack"]
        if data["component_stack"]:
            traceback = f"{traceback}\n\nReact component stack:{data['component_stack']}".strip()
        record_error(
            source=ErrorEvent.Source.FRONTEND,
            message=data["message"],
            exception_type=data["name"],
            traceback=traceback,
            logger="browser",
            path=_url_path(data["url"]),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
            user=request.user,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


def _url_path(url: str) -> str:
    """Just the path of the page the error happened on - the query string and fragment can
    carry search terms or share tokens."""
    return urlsplit(url).path if url else ""
