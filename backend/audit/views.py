from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

from accounts.models import User
from config.openapi import COMMON_ERRORS, NOT_FOUND
from config.pagination import DefaultPagination
from rbac.permissions import require_permission

from .models import AuditLog
from .serializers import ActivityEntrySerializer, AuditLogSerializer


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


def _visible_activity(queryset, viewer):
    """Keeps only entries whose target still exists and that `viewer` may
    see. The feed is org-wide, so without this every member saw the titles
    of RESTRICTED articles/questions (and answers under them) being
    published/asked/answered - the same rule knowledge.visibility applies
    everywhere else. Deleted targets are dropped too, rather than rendered
    as their frozen "Answer to <uuid>"-style target_repr."""
    from django.contrib.contenttypes.models import ContentType
    from django.db.models import Q

    from knowledge import visibility as visibility_rules
    from knowledge.models import Answer, Article, Question

    org = viewer.organization
    articles = visibility_rules.exclude_inaccessible(Article.objects.filter(organization=org), viewer, Article, "article")
    questions = visibility_rules.exclude_inaccessible(
        Question.objects.filter(organization=org), viewer, Question, "question"
    )
    answers = Answer.objects.filter(question__in=questions)

    def _ids(qs):
        # target_object_id is a CharField, so compare against string ids.
        return [str(pk) for pk in qs.values_list("pk", flat=True)]

    get_ct = ContentType.objects.get_for_model
    return queryset.filter(
        Q(target_content_type=get_ct(Article), target_object_id__in=_ids(articles))
        | Q(target_content_type=get_ct(Question), target_object_id__in=_ids(questions))
        | Q(target_content_type=get_ct(Answer), target_object_id__in=_ids(answers))
    ).prefetch_related("target")


@extend_schema(
    tags=["Audit"],
    summary="Public Knowledge activity feed (publish/submit/reject/archive/ask/answer/accept/promote only)",
    responses={200: ActivityEntrySerializer(many=True), **COMMON_ERRORS},
)
class KnowledgeActivityView(ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ActivityEntrySerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        return _visible_activity(
            AuditLog.objects.select_related("actor", "target_content_type").filter(
                organization=self.request.user.organization, action__in=KNOWLEDGE_ACTIVITY_ACTIONS
            ),
            self.request.user,
        )


@extend_schema(
    tags=["Audit"],
    summary="One user's personal recent-activity feed (same allowlist as the org-wide Knowledge activity feed)",
    responses={200: ActivityEntrySerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
)
class UserActivityView(ListAPIView):
    """The "what did THIS person contribute" answer, distinct from
    AuditLogListView's "what happened in the system" (the full admin log) -
    same KNOWLEDGE_ACTIVITY_ACTIONS allowlist as the Dashboard's own org-wide
    feed, just filtered to one actor. Powers ContributionsPanel's "Recent
    Activity" section on both /account and /users/[id]."""

    permission_classes = [IsAuthenticated]
    serializer_class = ActivityEntrySerializer
    pagination_class = DefaultPagination

    def get_queryset(self):
        target_user = get_object_or_404(User, pk=self.kwargs["pk"], organization=self.request.user.organization)
        return _visible_activity(
            AuditLog.objects.select_related("actor", "target_content_type").filter(
                organization=self.request.user.organization, actor=target_user, action__in=KNOWLEDGE_ACTIVITY_ACTIONS
            ),
            self.request.user,
        )
