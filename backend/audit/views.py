from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

from accounts.models import User
from config.openapi import COMMON_ERRORS, NOT_FOUND
from config.pagination import DefaultPagination
from rbac.permissions import require_permission

from .models import AuditLog
from .serializers import AuditLogSerializer


@extend_schema(tags=["Audit"], summary="List audit log entries", responses={200: AuditLogSerializer(many=True), **COMMON_ERRORS})
class AuditLogListView(ListAPIView):
    permission_classes = [require_permission("audit.read")]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        return AuditLog.objects.select_related("actor").filter(organization=self.request.user.organization)


# Explicit allowlist, not a denylist - the full audit log (above) includes
# sensitive actions (role/permission/org/file changes) that shouldn't be
# public-to-the-org, so this is a deliberately narrower, separate endpoint
# rather than a filter over the same one.
KNOWLEDGE_ACTIVITY_ACTIONS = [
    "article.publish",
    "article.submit",
    "article.reject",
    "article.archive",
    "question.create",
    "question.answer",
    "question.accept_answer",
    "question.promote",
]


@extend_schema(
    tags=["Audit"],
    summary="Public Knowledge activity feed (publish/submit/reject/archive/ask/answer/accept/promote only)",
    responses={200: AuditLogSerializer(many=True), **COMMON_ERRORS},
)
class KnowledgeActivityView(ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        return AuditLog.objects.select_related("actor").filter(
            organization=self.request.user.organization, action__in=KNOWLEDGE_ACTIVITY_ACTIONS
        )


@extend_schema(
    tags=["Audit"],
    summary="One user's personal recent-activity feed (same allowlist as the org-wide Knowledge activity feed)",
    responses={200: AuditLogSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
)
class UserActivityView(ListAPIView):
    """The "what did THIS person contribute" answer, distinct from
    AuditLogListView's "what happened in the system" (the full admin log) -
    same KNOWLEDGE_ACTIVITY_ACTIONS allowlist as the Dashboard's own org-wide
    feed, just filtered to one actor. Powers ContributionsPanel's "Recent
    Activity" section on both /account and /users/[id]."""

    permission_classes = [IsAuthenticated]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        target_user = get_object_or_404(User, pk=self.kwargs["pk"], organization=self.request.user.organization)
        return AuditLog.objects.select_related("actor").filter(
            organization=self.request.user.organization, actor=target_user, action__in=KNOWLEDGE_ACTIVITY_ACTIONS
        )
