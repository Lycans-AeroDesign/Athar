from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from rbac.permissions import require_permission

from . import services
from .models import PolicyAcceptance, PolicyKind
from .serializers import (
    AcceptPoliciesSerializer,
    CurrentPolicySerializer,
    PolicyDraftSerializer,
    PolicyDraftWriteSerializer,
    PolicyOverviewSerializer,
    PolicyVersionSerializer,
)


def _kind_or_404(kind: str) -> str:
    kind = kind.upper()
    if kind not in PolicyKind.values:
        raise NotFound(f"No policy kind '{kind}'.")
    return kind


class CurrentPoliciesView(APIView):
    """Reachable while policies are still pending (see policies.authentication's allowlist)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Policies"],
        summary="Current published policies, each with whether you've accepted it",
        responses={200: CurrentPolicySerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        versions = services.current_versions_for(request.user.organization).select_related("published_by")
        accepted_ids = set(
            PolicyAcceptance.objects.filter(user=request.user, version__in=versions).values_list("version_id", flat=True)
        )
        return Response(CurrentPolicySerializer(versions, many=True, context={"accepted_ids": accepted_ids}).data)


class AcceptPoliciesView(APIView):
    """Reachable while policies are still pending (see policies.authentication's allowlist)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Policies"],
        summary="Accept the current version of every policy you haven't accepted yet",
        request=AcceptPoliciesSerializer,
        responses={204: OpenApiResponse(description="Accepted."), 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = AcceptPoliciesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.accept_policies(user=request.user, version_ids=serializer.validated_data["version_ids"], request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PolicyOverviewView(APIView):
    permission_classes = [require_permission("organization.manage")]

    @extend_schema(
        tags=["Policies"],
        summary="Every policy's draft, current version, and acceptance count (requires organization.manage)",
        responses={200: PolicyOverviewSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        return Response(PolicyOverviewSerializer(services.overview_for(request.user.organization), many=True).data)


class PolicyDraftView(APIView):
    permission_classes = [require_permission("organization.manage")]

    @extend_schema(
        tags=["Policies"],
        summary="Save a policy's draft - not visible to members until published (requires organization.manage)",
        request=PolicyDraftWriteSerializer,
        responses={200: PolicyDraftSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def put(self, request, kind):
        kind = _kind_or_404(kind)
        serializer = PolicyDraftWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        draft = services.save_draft(
            organization=request.user.organization, kind=kind, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(PolicyDraftSerializer(draft).data)


class PolicyPublishView(APIView):
    permission_classes = [require_permission("organization.manage")]

    @extend_schema(
        tags=["Policies"],
        summary=(
            "Publish a policy's draft as a new version - every member must accept it before continuing "
            "(requires organization.manage)"
        ),
        request=None,
        responses={201: PolicyVersionSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, kind):
        kind = _kind_or_404(kind)
        version = services.publish_policy(organization=request.user.organization, kind=kind, actor=request.user, request=request)
        return Response(PolicyVersionSerializer(version).data, status=status.HTTP_201_CREATED)
