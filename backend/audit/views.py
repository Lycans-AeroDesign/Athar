from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

from config.openapi import COMMON_ERRORS
from config.pagination import DefaultPagination
from rbac.permissions import require_permission

from .models import AuditLog
from .serializers import AuditLogSerializer


@extend_schema(tags=["Audit"], summary="List audit log entries", responses={200: AuditLogSerializer(many=True), **COMMON_ERRORS})
class AuditLogListView(ListAPIView):
    permission_classes = [require_permission("audit.read")]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination
    queryset = AuditLog.objects.select_related("actor").all()


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
    queryset = AuditLog.objects.select_related("actor").filter(action__in=KNOWLEDGE_ACTIVITY_ACTIONS)
