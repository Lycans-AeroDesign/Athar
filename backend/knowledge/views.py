import csv
import uuid

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q, QuerySet
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import paginated_response
from files.models import StoredFile
from rbac.permissions import require_permission

from . import search
from . import services
from . import visibility as visibility_rules
from .models import (
    Answer,
    Article,
    ArticleAttachment,
    Bookmark,
    Category,
    Component,
    ComponentAttachment,
    ComponentCategory,
    Document,
    Failure,
    FailureAttachment,
    KnowledgeRelation,
    Project,
    ProjectAttachment,
    Question,
    QuestionAttachment,
    RestrictedAccessGrant,
    Sop,
    SopAttachment,
    StorageLocation,
    Tag,
    Test,
    TestAttachment,
)
from .serializers import (
    AcceptAnswerSerializer,
    AccessGrantSerializer,
    AddAttachmentSerializer,
    AnswerSerializer,
    AnswerWriteSerializer,
    ArticleAttachmentSerializer,
    ArticleDetailSerializer,
    ArticleListSerializer,
    ArticleRevisionSerializer,
    ArticleWriteSerializer,
    AuthorSerializer,
    BookmarkSerializer,
    CategorySerializer,
    CategoryWriteSerializer,
    ComponentAttachmentSerializer,
    ComponentCategorySerializer,
    ComponentCategoryWriteSerializer,
    ComponentDetailSerializer,
    ComponentListSerializer,
    ComponentWriteSerializer,
    CreateAccessGrantSerializer,
    CreateBookmarkSerializer,
    CreateRelationSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
    DocumentWriteSerializer,
    FailureAttachmentSerializer,
    FailureDetailSerializer,
    FailureListSerializer,
    FailureWriteSerializer,
    KnowledgeRelationSerializer,
    LeaderboardEntrySerializer,
    ProjectAttachmentSerializer,
    ProjectDetailSerializer,
    ProjectListSerializer,
    ProjectWriteSerializer,
    QuestionAttachmentSerializer,
    QuestionDetailSerializer,
    QuestionListSerializer,
    QuestionWriteSerializer,
    SopAttachmentSerializer,
    SopDetailSerializer,
    SopListSerializer,
    SopWriteSerializer,
    StorageLocationSerializer,
    StorageLocationWriteSerializer,
    TagSerializer,
    TagWriteSerializer,
    TestAttachmentSerializer,
    TestDetailSerializer,
    TestListSerializer,
    TestWriteSerializer,
    UserProfileSerializer,
)


class CategoryListView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("category.manage")()]
        return [IsAuthenticated()]

    @extend_schema(
        tags=["Knowledge"],
        summary="List knowledge categories",
        responses={200: CategorySerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = Category.objects.filter(organization=request.user.organization)
        return paginated_response(request, queryset, CategorySerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Create a knowledge category (requires category.manage)",
        request=CategoryWriteSerializer,
        responses={201: CategorySerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = services.create_category(actor=request.user, request=request, **serializer.validated_data)
        return Response(CategorySerializer(category).data, status=status.HTTP_201_CREATED)


class CategoryDetailView(APIView):
    permission_classes = [require_permission("category.manage")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Rename/update a knowledge category (requires category.manage)",
        request=CategoryWriteSerializer,
        responses={200: CategorySerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        category = get_object_or_404(Category, pk=pk, organization=request.user.organization)
        serializer = CategoryWriteSerializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        category = services.update_category(
            category=category, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(CategorySerializer(category).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Delete a knowledge category (requires category.manage; articles in it become uncategorized)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        category = get_object_or_404(Category, pk=pk, organization=request.user.organization)
        services.delete_category(category=category, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TagListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List tags, most-used first",
        responses={200: TagSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        tags = Tag.objects.filter(organization=request.user.organization).annotate(
            usage_count=Count("articles", distinct=True) + Count("questions", distinct=True)
        ).order_by("-usage_count", "name")
        return paginated_response(request, tags, TagSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Create (or reuse, if the normalized name already exists) a tag",
        request=TagWriteSerializer,
        responses={201: TagSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = TagWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tag = services.create_tag(actor=request.user, request=request, **serializer.validated_data)
        return Response(TagSerializer(tag).data, status=status.HTTP_201_CREATED)


class TagDetailView(APIView):
    permission_classes = [require_permission("tag.manage")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Delete a tag (requires tag.manage; removes it from every article/question)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        tag = get_object_or_404(Tag, pk=pk, organization=request.user.organization)
        services.delete_tag(tag=tag, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# Every relatable type that actually carries a `tags` M2M (see models.py) -
# Failure is deliberately excluded, it has no tags field. Used by SearchView
# below to reject/no-op a ?tag= filter against a type that can't have one,
# rather than letting `.filter(tags=...)` raise a FieldError.
_TAGGABLE_TYPES = {"article", "question", "project", "component", "sop", "test", "document"}


class SearchView(APIView):
    """Postgres full-text search (with trigram-similarity fallback for mid-
    word/typo matches) across every relatable content type, ranked by
    relevance - see knowledge/search.py for the shared implementation.
    Category/tag-name matching isn't included yet (see docs/VISION.md #12's
    fuller sketch).

    Also doubles as the "browse everything with this tag" endpoint (?tag=
    instead of/alongside ?q=) - the same per-type visibility filtering,
    counts, scoping, and pagination apply either way, so the frontend's tag
    page reuses this endpoint (and its own search-results rendering) rather
    than a separate one. A tag-only request (no ?q=) has no relevance score
    to rank by, so `sort=relevance` (the default) silently falls back to
    `newest` when there's no query - see the `order` computation below."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary=(
            "Search across articles, questions, projects, components, failures, SOPs, tests, and documents "
            "(?q= and/or ?tag=<tag id>, at least one required; optional ?type=<one of those> to scope to one "
            "section; ?sort=relevance|newest|oldest, default relevance (falls back to newest for a tag-only, "
            "no-?q= request); ?page= for 20-per-type pages within that scope)"
        ),
        responses={
            200: OpenApiResponse(
                description=(
                    "{'tag': {id, name} | null, 'results': [{type, id, title, excerpt}, ...], 'has_more': bool, "
                    "'counts': {article, question, project, component, failure, sop, test, document: int}} - counts "
                    "reflect the query/tag across every type regardless of ?type=, so the UI can show "
                    "per-type totals for a filter list."
                )
            ),
            400: BAD_REQUEST,
            **COMMON_ERRORS,
        },
    )
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        tag_id = request.query_params.get("tag") or None
        tag = None
        if tag_id:
            try:
                tag = Tag.objects.get(pk=uuid.UUID(tag_id), organization=request.user.organization)
            except (ValueError, Tag.DoesNotExist):
                raise ValidationError("No tag with that id in your organization.")
        scope = request.query_params.get("type") or None
        valid_types = ("article", "question", "project", "component", "failure", "sop", "test", "document")
        if scope not in (None, *valid_types):
            raise ValidationError(f"type must be one of {', '.join(valid_types)}.")
        sort_param = request.query_params.get("sort", "relevance")
        if sort_param not in ("relevance", "newest", "oldest"):
            raise ValidationError("sort must be 'relevance', 'newest', or 'oldest'.")
        if sort_param == "newest":
            order = ("-updated_at",)
        elif sort_param == "oldest":
            order = ("updated_at",)
        elif query:
            order = ("-rank", "-similarity", "-updated_at")
        else:
            order = ("-updated_at",)  # "relevance" with no ?q= (tag-only) has no rank to sort by.
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            raise ValidationError("page must be an integer.")
        offset = (page - 1) * 20

        # Built regardless of `scope` - counts below need the unscoped totals
        # even when the caller is only viewing one type's results. Every type
        # now carries a `visibility` field (see models.py) - each queryset
        # below is already narrowed to what request.user may see via the
        # matching services.visible_*_for helper, then further filtered by
        # tag and/or ranked by knowledge.search.search_filter.
        def matches_for(type_name: str, visible_queryset: QuerySet) -> QuerySet:
            if not (query or tag):
                return visible_queryset.none()
            queryset = visible_queryset
            if tag:
                if type_name not in _TAGGABLE_TYPES:
                    return visible_queryset.none()
                queryset = queryset.filter(tags=tag)
            if query:
                queryset = search.search_filter(queryset, query, type_name)
            return queryset

        article_matches = matches_for("article", services.visible_articles_for(request.user))
        question_matches = matches_for("question", services.visible_questions_for(request.user))
        project_matches = matches_for("project", services.visible_projects_for(request.user))
        component_matches = matches_for("component", services.visible_components_for(request.user))
        failure_matches = matches_for("failure", services.visible_failures_for(request.user))
        sop_matches = matches_for("sop", services.visible_sops_for(request.user))
        test_matches = matches_for("test", services.visible_tests_for(request.user))
        document_matches = matches_for("document", services.visible_documents_for(request.user))
        counts = {
            "article": article_matches.count(),
            "question": question_matches.count(),
            "project": project_matches.count(),
            "component": component_matches.count(),
            "failure": failure_matches.count(),
            "sop": sop_matches.count(),
            "test": test_matches.count(),
            "document": document_matches.count(),
        }

        # Each type is paginated independently (offset/limit per type, not
        # across the combined list) - simplest thing that supports "page 2 of
        # articles" and "page 2 of questions" without a shared cursor across
        # different querysets. has_more is True only for whichever type(s)
        # actually have more rows past this page.
        results = []
        has_more = False

        def collect(type_name: str, matches, title_field: str, excerpt_source) -> None:
            nonlocal has_more
            if not ((query or tag) and scope in (None, type_name)):
                return
            page_qs = matches.order_by(*order)
            rows = page_qs[offset : offset + 20]
            has_more = has_more or page_qs[offset + 20 : offset + 21].exists()
            for row in rows:
                excerpt = excerpt_source(row) if callable(excerpt_source) else getattr(row, excerpt_source, "")
                results.append(
                    {
                        "type": type_name,
                        "id": str(row.id),
                        "title": getattr(row, title_field),
                        "excerpt": search.plain_text_excerpt(excerpt),
                    }
                )

        collect("article", article_matches, "title", "excerpt")
        collect("question", question_matches, "title", "body")
        collect("project", project_matches, "name", "description")
        collect("component", component_matches, "name", "summary")
        collect("failure", failure_matches, "title", "summary")
        collect("sop", sop_matches, "title", "content")
        collect("test", test_matches, "title", lambda t: t.results or t.objective)
        collect("document", document_matches, "title", "description")

        return Response(
            {"tag": TagSerializer(tag).data if tag else None, "results": results, "has_more": has_more, "counts": counts}
        )


# name -> (queryset, list serializer) - one entry per real contribution type.
# Answer has no visibility of its own; it's gated through its parent question's
# visibility instead (services.visible_questions_for), same as everywhere else
# in this file an Answer's access follows its Question. Every queryset here
# goes through the matching services.visible_*_for helper (not a bare
# created_by= filter) so that viewing someone else's profile can't leak their
# RESTRICTED content the viewer isn't privileged for or granted on.
def _contribution_handlers(request, user):
    return {
        "article": (services.visible_articles_for(request.user).filter(author=user), ArticleListSerializer),
        "question": (services.visible_questions_for(request.user).filter(author=user), QuestionListSerializer),
        "answer": (
            Answer.objects.filter(author=user, question__in=services.visible_questions_for(request.user)),
            AnswerSerializer,
        ),
        "project": (services.visible_projects_for(request.user).filter(created_by=user), ProjectListSerializer),
        "component": (services.visible_components_for(request.user).filter(created_by=user), ComponentListSerializer),
        "failure": (services.visible_failures_for(request.user).filter(created_by=user), FailureListSerializer),
        "sop": (services.visible_sops_for(request.user).filter(created_by=user), SopListSerializer),
        "test": (services.visible_tests_for(request.user).filter(created_by=user), TestListSerializer),
        "document": (services.visible_documents_for(request.user).filter(created_by=user), DocumentListSerializer),
    }


class UserProfileView(APIView):
    """Public-safe profile + aggregate contribution stats for any user, not
    just yourself (see accounts.views.MeView for the self-only equivalent) -
    what powers the "click an author's name/avatar" profile page."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Get a user's public profile and contribution stats",
        responses={200: UserProfileSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        user = get_object_or_404(User, pk=pk, organization=request.user.organization)
        handlers = _contribution_handlers(request, user)
        stats = {contribution_type: queryset.count() for contribution_type, (queryset, _) in handlers.items()}
        stats["accepted_answers"] = services.visible_questions_for(request.user).filter(
            accepted_answer__author=user
        ).count()
        # One {score, rank} pair per window - "month"/"year" are calendar
        # to-date (see services.period_since), "all" is lifetime, the same
        # weighted score the leaderboard sorts by (see scoring.py). 0/None
        # for a user with no scored actions in that window yet, not absent,
        # so the profile page/ContributionsPanel can always render a number.
        periods = {}
        for period in ("month", "year", "all"):
            scores = services.compute_contribution_scores_for(
                request.user.organization, since=services.period_since(period)
            )
            periods[period] = {"score": scores.get(user.id, 0), "rank": services.rank_for(scores, user.id)}
        total_members = User.objects.filter(organization=request.user.organization).count()
        return Response(
            UserProfileSerializer(
                user, context={"stats": stats, "periods": periods, "total_members": total_members}
            ).data
        )


class UserContributionsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary=(
            "List one of a user's contribution types, paginated "
            "(?type=article|question|answer|project|component|failure|sop|test|document, required)"
        ),
        responses={200: OpenApiResponse(description="Paginated list, in that type's own list-serializer shape."), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        user = get_object_or_404(User, pk=pk, organization=request.user.organization)
        handlers = _contribution_handlers(request, user)
        contribution_type = request.query_params.get("type")
        handler = handlers.get(contribution_type)
        if handler is None:
            raise ValidationError(f"type must be one of {', '.join(handlers)}.")
        queryset, serializer_class = handler
        return paginated_response(request, queryset, serializer_class)


class LeaderboardView(APIView):
    """Org-scoped "Top Contributors" list for the Dashboard - see
    services.leaderboard_for/compute_contribution_scores_for and
    knowledge/scoring.py's CONTRIBUTION_POINTS table."""

    permission_classes = [IsAuthenticated]

    VALID_PERIODS = {"month", "year", "all"}

    @extend_schema(
        tags=["Knowledge"],
        summary="Top contributors leaderboard for the caller's organization (?period=month|year|all, default all)",
        responses={200: LeaderboardEntrySerializer(many=True), 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def get(self, request):
        period = request.query_params.get("period", "all")
        if period not in self.VALID_PERIODS:
            raise ValidationError(f"period must be one of {', '.join(sorted(self.VALID_PERIODS))}.")
        entries = services.leaderboard_for(request.user.organization, since=services.period_since(period))
        return Response(LeaderboardEntrySerializer(entries, many=True).data)


def _visible_instance_or_404(request, queryset_or_model, model_name: str, pk):
    """Shared GET-only lookup for every relatable content type: 404s if it's
    not in the caller's org, 403s if it exists but RESTRICTED and the caller
    isn't privileged for it or explicitly granted - see
    knowledge/visibility.py for the single rule this defers to."""
    instance = get_object_or_404(queryset_or_model, pk=pk, organization=request.user.organization)
    if not visibility_rules.can_view_instance(request.user, model_name, instance):
        raise PermissionDenied(f"This {model_name} isn't accessible to you.")
    return instance


def _visible_article_or_404(request, pk):
    article = get_object_or_404(
        Article.objects.select_related("category", "author"), pk=pk, organization=request.user.organization
    )
    is_privileged = visibility_rules.is_privileged_for(request.user, "article", article)
    # PUBLISHED + visible-to-viewer (not RESTRICTED, or RESTRICTED but the
    # viewer is privileged or explicitly granted) is the common case;
    # anything still in DRAFT/IN_REVIEW/etc requires being privileged
    # regardless of visibility - a grant only ever applies to published work.
    if article.status == Article.Status.PUBLISHED and visibility_rules.can_view_instance(
        request.user, "article", article
    ):
        return article
    if is_privileged:
        return article
    raise PermissionDenied("This article isn't accessible to you.")


def _visible_question_or_404(request, pk):
    queryset = Question.objects.select_related("author").prefetch_related("tags", "answers__author")
    return _visible_instance_or_404(request, queryset, "question", pk)


def _visible_project_or_404(request, pk):
    return _visible_instance_or_404(request, Project, "project", pk)


def _visible_component_or_404(request, pk):
    return _visible_instance_or_404(request, Component, "component", pk)


def _visible_failure_or_404(request, pk):
    return _visible_instance_or_404(request, Failure, "failure", pk)


def _visible_sop_or_404(request, pk):
    return _visible_instance_or_404(request, Sop, "sop", pk)


def _visible_test_or_404(request, pk):
    return _visible_instance_or_404(request, Test, "test", pk)


class ArticleListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("article.create")()]
        return [require_permission("article.read")()]

    @extend_schema(
        tags=["Knowledge"],
        summary=(
            "List articles (published by default; ?status=<state> for other states, "
            "own-authored or reviewer/publisher only; ?status=ALL for every state at once)"
        ),
        responses={200: ArticleListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        status_param = request.query_params.get("status", Article.Status.PUBLISHED)
        queryset = Article.objects.filter(organization=request.user.organization).select_related(
            "category", "author"
        ).prefetch_related("tags")
        can_review = request.user.has_permission("article.review") or request.user.has_permission("article.publish")
        if status_param == "ALL":
            # A reviewer/publisher sees every article regardless of status -
            # no further filtering needed. Everyone else sees every
            # published article they'd normally see (still excluding
            # RESTRICTED ones that aren't theirs) plus their own articles in
            # any other status, since those aren't discoverable by anyone else.
            if not can_review:
                queryset = queryset.filter(Q(status=Article.Status.PUBLISHED) | Q(author=request.user))
                published = queryset.filter(status=Article.Status.PUBLISHED)
                accessible_published_ids = visibility_rules.exclude_inaccessible(
                    published, request.user, Article, "article"
                ).values_list("id", flat=True)
                queryset = queryset.exclude(
                    Q(status=Article.Status.PUBLISHED) & ~Q(id__in=accessible_published_ids)
                )
        elif status_param == Article.Status.PUBLISHED:
            queryset = services.visible_articles_for(request.user).select_related(
                "category", "author"
            ).prefetch_related("tags")
        elif can_review:
            queryset = queryset.filter(status=status_param)
        else:
            queryset = queryset.filter(status=status_param, author=request.user)
        return paginated_response(request, queryset, ArticleListSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Create an article (starts as a draft)",
        request=ArticleWriteSerializer,
        responses={201: ArticleDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = ArticleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        article = services.create_article(actor=request.user, request=request, **serializer.validated_data)
        return Response(ArticleDetailSerializer(article).data, status=status.HTTP_201_CREATED)


class ArticleDetailView(APIView):
    permission_classes = [require_permission("article.create")]

    def get_permissions(self):
        if self.request.method == "GET":
            return [require_permission("article.read")()]
        return super().get_permissions()

    @extend_schema(
        tags=["Knowledge"],
        summary="Get an article (must be published, or you must be the author/a reviewer/a publisher)",
        responses={200: ArticleDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        article = _visible_article_or_404(request, pk)
        return Response(ArticleDetailSerializer(article, context={"request": request}).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Update an article (own draft/in-review, or requires article.update)",
        request=ArticleWriteSerializer,
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        serializer = ArticleWriteSerializer(article, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        article = services.update_article(
            article=article, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ArticleDetailSerializer(article).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Delete an article (own draft, or requires article.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        services.delete_article(article=article, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ArticleSubmitView(APIView):
    permission_classes = [require_permission("article.create")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Submit a draft article for review (author only)",
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        article = services.submit_article(article=article, actor=request.user, request=request)
        return Response(ArticleDetailSerializer(article).data)


class ArticlePublishView(APIView):
    permission_classes = [require_permission("article.publish")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Publish a draft or in-review article",
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        article = services.publish_article(article=article, actor=request.user, request=request)
        return Response(ArticleDetailSerializer(article).data)


class ArticleRejectView(APIView):
    permission_classes = [require_permission("article.review")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Reject an in-review article, sending it back to the author to revise and resubmit",
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        article = services.reject_article(
            article=article, actor=request.user, reason=request.data.get("reason", ""), request=request
        )
        return Response(ArticleDetailSerializer(article).data)


class ArticleArchiveView(APIView):
    permission_classes = [require_permission("article.archive")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Archive a published article",
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        article = services.archive_article(article=article, actor=request.user, request=request)
        return Response(ArticleDetailSerializer(article).data)


class ArticleUnarchiveView(APIView):
    permission_classes = [require_permission("article.archive")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Restore an archived article to published",
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        article = services.unarchive_article(article=article, actor=request.user, request=request)
        return Response(ArticleDetailSerializer(article).data)


class ArticleRevisionListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List an article's revision history, most recent first (same visibility as the article itself)",
        responses={200: ArticleRevisionSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        article = _visible_article_or_404(request, pk)
        return Response(ArticleRevisionSerializer(article.revisions.select_related("edited_by"), many=True).data)


class QuestionListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("question.create")()]
        return [IsAuthenticated()]

    @extend_schema(
        tags=["Knowledge"],
        summary="List questions (optionally filtered by ?status=)",
        responses={200: QuestionListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        questions = services.visible_questions_for(request.user).select_related("author").prefetch_related(
            "tags", "answers"
        )
        status_param = request.query_params.get("status")
        if status_param:
            questions = questions.filter(status=status_param)
        return paginated_response(request, questions, QuestionListSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Ask a question",
        request=QuestionWriteSerializer,
        responses={201: QuestionDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = QuestionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        question = services.create_question(actor=request.user, request=request, **serializer.validated_data)
        return Response(QuestionDetailSerializer(question).data, status=status.HTTP_201_CREATED)


class QuestionDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [require_permission("question.create")()]

    @extend_schema(
        tags=["Knowledge"],
        summary="Get a question with its answers",
        responses={200: QuestionDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        question = _visible_question_or_404(request, pk)
        return Response(QuestionDetailSerializer(question, context={"request": request}).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Update a question (own, or requires question.moderate)",
        request=QuestionWriteSerializer,
        responses={200: QuestionDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        serializer = QuestionWriteSerializer(question, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        question = services.update_question(
            question=question, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(QuestionDetailSerializer(question).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Delete a question (own, or requires question.moderate)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        services.delete_question(question=question, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionCloseView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Close a question to new answers (question author or question.moderate only)",
        responses={200: QuestionDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        question = services.close_question(question=question, actor=request.user, request=request)
        return Response(QuestionDetailSerializer(question).data)


class QuestionReopenView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Reopen a closed question (question author or question.moderate only)",
        responses={200: QuestionDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        question = services.reopen_question(question=question, actor=request.user, request=request)
        return Response(QuestionDetailSerializer(question).data)


class QuestionPromoteView(APIView):
    permission_classes = [require_permission("article.create")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Promote a solved question (one with an accepted answer) into a new draft article",
        responses={201: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        article = services.promote_question_to_article(question=question, actor=request.user, request=request)
        return Response(ArticleDetailSerializer(article).data, status=status.HTTP_201_CREATED)


class AnswerListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("question.answer")()]
        return [IsAuthenticated()]

    @extend_schema(
        tags=["Knowledge"],
        summary="List a question's answers",
        responses={200: AnswerSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        # Same visibility gate as QuestionDetailView - an org-only lookup
        # here let anyone read (and add to) the answers of a RESTRICTED
        # question they can't even open.
        question = _visible_question_or_404(request, pk)
        return paginated_response(request, question.answers.select_related("author"), AnswerSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Answer a question",
        request=AnswerWriteSerializer,
        responses={201: AnswerSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = _visible_question_or_404(request, pk)
        serializer = AnswerWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answer = services.create_answer(
            question=question, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(AnswerSerializer(answer).data, status=status.HTTP_201_CREATED)


class AnswerDetailView(APIView):
    permission_classes = [require_permission("question.answer")]

    @extend_schema(
        tags=["Knowledge"],
        summary="Update an answer (own, or requires question.moderate)",
        request=AnswerWriteSerializer,
        responses={200: AnswerSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        answer = get_object_or_404(Answer, pk=pk, question__organization=request.user.organization)
        serializer = AnswerWriteSerializer(answer, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        answer = services.update_answer(answer=answer, actor=request.user, request=request, **serializer.validated_data)
        return Response(AnswerSerializer(answer).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Delete an answer (own, or requires question.moderate)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        answer = get_object_or_404(Answer, pk=pk, question__organization=request.user.organization)
        services.delete_answer(answer=answer, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionAcceptAnswerView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Accept (or, with answer_id: null, unaccept) an answer to a question (question author or question.moderate only)",
        request=AcceptAnswerSerializer,
        responses={200: QuestionDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        serializer = AcceptAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answer_id = serializer.validated_data["answer_id"]
        answer = get_object_or_404(Answer, pk=answer_id, question__organization=request.user.organization) if answer_id else None
        question = services.accept_answer(question=question, actor=request.user, answer=answer, request=request)
        return Response(QuestionDetailSerializer(question).data)


class ArticleRelationsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List an article's related content (articles/questions linked either direction)",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        article = _visible_article_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Article)
        relations = services.get_relations_for("article", article.id, actor=request.user)
        serializer = KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, article.id)})
        return Response(serializer.data)


class QuestionRelationsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List a question's related content (articles/questions linked either direction)",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        question = _visible_question_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Question)
        relations = services.get_relations_for("question", question.id, actor=request.user)
        serializer = KnowledgeRelationSerializer(
            relations, many=True, context={"viewer": (content_type, question.id)}
        )
        return Response(serializer.data)


class RelationCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Link two articles/questions as related content (requires edit rights on the source item)",
        request=CreateRelationSerializer,
        responses={201: KnowledgeRelationSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CreateRelationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        relation = services.create_relation(actor=request.user, request=request, **serializer.validated_data)
        viewer_content_type = ContentType.objects.get(
            model=serializer.validated_data["source_type"], app_label="knowledge"
        )
        response_serializer = KnowledgeRelationSerializer(
            relation, context={"viewer": (viewer_content_type, serializer.validated_data["source_id"])}
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class RelationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Remove a related-content link",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        relation = get_object_or_404(KnowledgeRelation, pk=pk, organization=request.user.organization)
        services.delete_relation(relation=relation, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ArticleAttachmentListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List an article's attachments",
        responses={200: ArticleAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        article = _visible_article_or_404(request, pk)
        attachments = article.attachments.select_related("file", "uploaded_by")
        return Response(ArticleAttachmentSerializer(attachments, many=True).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Attach an already-uploaded file to an article (own draft/in-review, or requires article.update)",
        request=AddAttachmentSerializer,
        responses={201: ArticleAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        article = get_object_or_404(Article, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_article_attachment(article=article, file=file, actor=request.user, request=request)
        return Response(ArticleAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class ArticleAttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Remove an article attachment (own draft/in-review, or requires article.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(ArticleAttachment, pk=attachment_pk, article_id=pk, article__organization=request.user.organization)
        services.remove_article_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionAttachmentListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List a question's attachments",
        responses={200: QuestionAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        question = _visible_question_or_404(request, pk)
        attachments = question.attachments.select_related("file", "uploaded_by")
        return Response(QuestionAttachmentSerializer(attachments, many=True).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Attach an already-uploaded file to a question (own question, or requires question.moderate)",
        request=AddAttachmentSerializer,
        responses={201: QuestionAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_question_attachment(
            question=question, file=file, actor=request.user, request=request
        )
        return Response(QuestionAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class QuestionAttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Remove a question attachment (own question, or requires question.moderate)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(QuestionAttachment, pk=attachment_pk, question_id=pk, question__organization=request.user.organization)
        services.remove_question_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Engineering domain (Project/Component/Failure/Sop) --------------------
#
# No draft/review workflow (see models.py), but each type does carry a
# `visibility` field - GET endpoints route through the matching
# _visible_x_or_404 helper (or services.visible_x_for for lists), same
# RESTRICTED rule as Article/Question/Document. Write endpoints keep the
# permission-only gating they already had (x.read/x.update/x.delete),
# unchanged.


class ProjectListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("project.create")()]
        return [require_permission("project.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List projects (optional ?status=, ?q=<search name/description>)",
        responses={200: ProjectListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_projects_for(request.user).prefetch_related(
            "tags"
        ).select_related("created_by")
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = search.search_filter(queryset, query, "project")
        return paginated_response(request, queryset, ProjectListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create a project",
        request=ProjectWriteSerializer,
        responses={201: ProjectDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = ProjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = services.create_project(actor=request.user, request=request, **serializer.validated_data)
        return Response(ProjectDetailSerializer(project).data, status=status.HTTP_201_CREATED)


class ProjectDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("project.update")()]
        if self.request.method == "DELETE":
            return [require_permission("project.delete")()]
        return [require_permission("project.read")()]

    @extend_schema(
        tags=["Engineering"], summary="Get a project", responses={200: ProjectDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def get(self, request, pk):
        project = _visible_project_or_404(request, pk)
        return Response(ProjectDetailSerializer(project, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a project (requires project.update)",
        request=ProjectWriteSerializer,
        responses={200: ProjectDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        project = get_object_or_404(Project, pk=pk, organization=request.user.organization)
        serializer = ProjectWriteSerializer(project, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        project = services.update_project(project=project, actor=request.user, request=request, **serializer.validated_data)
        return Response(ProjectDetailSerializer(project).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a project (requires project.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        project = get_object_or_404(Project, pk=pk, organization=request.user.organization)
        services.delete_project(project=project, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectRelationsView(APIView):
    permission_classes = [require_permission("project.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List a project's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        project = _visible_project_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Project)
        relations = services.get_relations_for("project", project.id, actor=request.user)
        return Response(KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, project.id)}).data)


class ProjectAttachmentListView(APIView):
    permission_classes = [require_permission("project.read")]

    @extend_schema(
        tags=["Engineering"], summary="List a project's attachments",
        responses={200: ProjectAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        project = _visible_project_or_404(request, pk)
        return Response(ProjectAttachmentSerializer(project.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a project (requires project.update)",
        request=AddAttachmentSerializer,
        responses={201: ProjectAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        project = get_object_or_404(Project, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_project_attachment(project=project, file=file, actor=request.user, request=request)
        return Response(ProjectAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class ProjectAttachmentDetailView(APIView):
    permission_classes = [require_permission("project.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a project attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(ProjectAttachment, pk=attachment_pk, project_id=pk, project__organization=request.user.organization)
        services.remove_project_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


def apply_ordering(queryset, request, fields: dict[str, str]):
    """Shared ?ordering= handling for every list view that backs a sortable
    frontend table (see frontend/components/ui/DataTable.tsx) - `fields` is
    that view's own allowlist mapping a public field name to the actual
    model lookup to sort by (e.g. COMPONENT_ORDERING_FIELDS below), an
    allowlist rather than passing the raw param straight to .order_by(),
    which would let a caller sort (and leak ordering-oracle info about)
    arbitrary related fields. ?ordering= is optionally "-"-prefixed for
    descending (e.g. "-quantity_available") - an unrecognized value is
    silently ignored rather than a 400, since it only ever comes from that
    same view's own UI, never hand-typed by an API consumer that needs
    strict validation."""
    ordering_param = request.query_params.get("ordering", "").strip()
    if not ordering_param:
        return queryset
    descending = ordering_param.startswith("-")
    field = fields.get(ordering_param[1:] if descending else ordering_param)
    if not field:
        return queryset
    return queryset.order_by(f"-{field}" if descending else field)


# Tags/photo aren't sortable here - a M2M and a FK with no natural order -
# so they're left out entirely; the table view just doesn't offer a sort
# control for those columns.
COMPONENT_ORDERING_FIELDS = {
    "name": "name",
    "category": "category__name",
    "manufacturer": "manufacturer",
    "part_number": "part_number",
    "status": "status",
    "quantity_available": "quantity_available",
    "visibility": "visibility",
    "inventory_type": "inventory_type",
    "location": "location__name",
    "unit": "unit",
    "condition": "condition",
    "stock_status": "stock_status",
    "min_quantity": "min_quantity",
    "created_at": "created_at",
    "updated_at": "updated_at",
}

# The select_related/prefetch_related every component list/export needs.
_COMPONENT_LIST_RELATED = ("category", "location", "created_by", "updated_by", "photo")


def _uuid_param(request, name: str):
    """A ?name=<uuid> filter value, or a 400 - a malformed id would otherwise
    500 on the UUID column lookup."""
    raw = request.query_params.get(name, "").strip()
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise ValidationError({name: ["Must be a valid id."]})


def _filter_and_order_components(queryset, request):
    """Shared filter/?q=/?ordering= handling for ComponentListCreateView.get,
    ComponentExportView.get and ComponentInventorySummaryView.get, so
    "export" and the summary keep meaning "what I'm currently looking at".
    ?stock_status= takes a comma-separated list (the "Needs ordering" view is
    MISSING,ON_ORDER); every other filter takes one value."""
    category_id = _uuid_param(request, "category")
    if category_id:
        queryset = queryset.filter(category_id=category_id)
    location_id = _uuid_param(request, "location")
    if location_id:
        queryset = queryset.filter(location_id=location_id)
    for param in ("status", "inventory_type", "condition"):
        value = request.query_params.get(param)
        if value:
            queryset = queryset.filter(**{param: value})
    stock_statuses = [value for value in request.query_params.get("stock_status", "").split(",") if value.strip()]
    if stock_statuses:
        queryset = queryset.filter(stock_status__in=[value.strip() for value in stock_statuses])
    query = request.query_params.get("q", "").strip()
    if query:
        queryset = search.search_filter(queryset, query, "component")
    return apply_ordering(queryset, request, COMPONENT_ORDERING_FIELDS)


class ComponentListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("component.create")()]
        return [require_permission("component.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "List components (optional ?category=<id>, ?location=<id>, ?status=, ?inventory_type=, ?condition=, "
            "?stock_status=<comma-separated>, ?q=<search name/summary/manufacturer/part number/notes>, "
            "?ordering=<field, \"-\"-prefixed for descending - see COMPONENT_ORDERING_FIELDS>)"
        ),
        responses={200: ComponentListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_components_for(request.user).select_related(
            *_COMPONENT_LIST_RELATED
        ).prefetch_related("tags")
        queryset = _filter_and_order_components(queryset, request)
        return paginated_response(request, queryset, ComponentListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create a component",
        request=ComponentWriteSerializer,
        responses={201: ComponentDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = ComponentWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        component = services.create_component(actor=request.user, request=request, **serializer.validated_data)
        return Response(ComponentDetailSerializer(component).data, status=status.HTTP_201_CREATED)


def _csv_response(filename: str) -> HttpResponse:
    """A CSV download that Excel opens correctly: the UTF-8 byte-order mark
    is what tells Excel the file is UTF-8 - without it, "–" dashes and any
    Arabic text show up garbled."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.write("\ufeff")
    return response


class ComponentExportView(APIView):
    """CSV export for the Components list page - same filters/?q=/?ordering=
    as ComponentListCreateView.get, so "export" means "export what I'm
    currently looking at", not always the whole org's inventory. Laid out to
    paste straight back into the workshop inventory sheet - see
    services.INVENTORY_CSV_COLUMNS."""

    permission_classes = [require_permission("component.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="Export visible components as CSV (same filters and ?ordering= as the list endpoint)",
        responses={200: OpenApiResponse(description="CSV file (text/csv)."), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_components_for(request.user).select_related(
            *_COMPONENT_LIST_RELATED
        ).prefetch_related("tags")
        queryset = _filter_and_order_components(queryset, request)

        inventory_type = request.query_params.get("inventory_type", "").lower()
        response = _csv_response(f"inventory-{inventory_type}.csv" if inventory_type else "components.csv")
        writer = csv.writer(response)
        for row in services.component_csv_rows(queryset):
            writer.writerow(row)
        return response


class ComponentImportTemplateView(APIView):
    """A blank starting point for ComponentImportView - same column set,
    with one filled-in example row so the free-text Specifications format
    ("Label: Value; Label: Value") is self-documenting rather than needing a
    separate help page."""

    permission_classes = [require_permission("component.create")]

    @extend_schema(
        tags=["Engineering"],
        summary="Download a blank CSV template for bulk-importing components",
        responses={200: OpenApiResponse(description="CSV file (text/csv)."), **COMMON_ERRORS},
    )
    def get(self, request):
        response = _csv_response("components-template.csv")
        writer = csv.writer(response)
        for row in services.component_import_template_rows():
            writer.writerow(row)
        return response


class ComponentImportView(APIView):
    """Preview or apply a bulk CSV import of components (see
    services.import_components_csv/component_import_template_rows for the
    expected columns and the preview/commit contract) - gated on
    component.create, same as creating one component at a time, since a
    "create" row is that same action just repeated. Updating an existing
    match additionally needs component.update, checked per-row by
    services._classify_component_row so a Member's import still creates
    what it can rather than failing outright."""

    permission_classes = [require_permission("component.create")]
    parser_classes = [MultiPartParser]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "Preview (commit=false, the default) or apply (commit=true) a bulk CSV import of components "
            "(multipart fields: file, commit, duplicates=separate|merge, inventory_type=MECHANICAL|ELECTRICAL)"
        ),
        responses={
            200: OpenApiResponse(
                description=(
                    '{"rows": [{"row": int, "action": "create"|"update"|"unchanged"|"error"|"merged", '
                    '"name"?: str, "changes"?: object, "message"?: str, "warnings": [str], "merged_into"?: int}], '
                    '"summary": {"create": int, "update": int, "unchanged": int, "error": int, "merged": int, '
                    '"duplicate_groups": int}, "applied"?: {"created": int, "updated": int, "skipped": int}}'
                )
            ),
            400: BAD_REQUEST,
            **COMMON_ERRORS,
        },
    )
    def post(self, request):
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            raise ValidationError({"file": ["This field is required."]})
        commit = str(request.data.get("commit", "")).strip().lower() in ("true", "1")
        duplicates = str(request.data.get("duplicates", "separate")).strip().lower() or "separate"
        if duplicates not in ("separate", "merge"):
            raise ValidationError({"duplicates": ['Must be "separate" or "merge".']})
        inventory_type = str(request.data.get("inventory_type", "")).strip().upper()
        if inventory_type and inventory_type not in Component.InventoryType.values:
            raise ValidationError({"inventory_type": [f"Must be one of {', '.join(Component.InventoryType.values)}."]})
        result = services.import_components_csv(
            actor=request.user,
            request=request,
            csv_file=uploaded_file,
            commit=commit,
            duplicates=duplicates,
            default_inventory_type=inventory_type,
        )
        return Response(result)


class ComponentInventorySummaryView(APIView):
    """The inventory sheet's Summary tab, live - counts per stock status and
    per category, over the same filters as the list (so "Mechanical only"
    is just ?inventory_type=MECHANICAL)."""

    permission_classes = [require_permission("component.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="Inventory totals by stock status and by category (same filters as the component list)",
        responses={
            200: OpenApiResponse(
                description=(
                    '{"total": int, "by_status": {"IN_STOCK": int, ..., "UNTRACKED": int}, '
                    '"by_category": [{"category": str|null, "total": int, "by_status": {...}}]}'
                )
            ),
            **COMMON_ERRORS,
        },
    )
    def get(self, request):
        queryset = _filter_and_order_components(services.visible_components_for(request.user), request)
        return Response(services.inventory_summary(queryset))


class ComponentCategoryListView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("category.manage")()]
        return [require_permission("component.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List component categories",
        responses={200: ComponentCategorySerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = ComponentCategory.objects.filter(organization=request.user.organization).annotate(
            component_count=Count("components")
        )
        return paginated_response(request, queryset, ComponentCategorySerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create a component category (requires category.manage)",
        request=ComponentCategoryWriteSerializer,
        responses={201: ComponentCategorySerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = ComponentCategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if ComponentCategory.objects.filter(
            organization=request.user.organization, name__iexact=serializer.validated_data["name"].strip()
        ).exists():
            raise ValidationError({"name": ["A component category with this name already exists."]})
        category = services.create_component_category(actor=request.user, request=request, **serializer.validated_data)
        return Response(ComponentCategorySerializer(category).data, status=status.HTTP_201_CREATED)


class ComponentCategoryDetailView(APIView):
    permission_classes = [require_permission("category.manage")]

    @extend_schema(
        tags=["Engineering"],
        summary="Rename/update a component category (requires category.manage)",
        request=ComponentCategoryWriteSerializer,
        responses={200: ComponentCategorySerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        category = get_object_or_404(ComponentCategory, pk=pk, organization=request.user.organization)
        serializer = ComponentCategoryWriteSerializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data.get("name", "").strip()
        if name and ComponentCategory.objects.filter(
            organization=request.user.organization, name__iexact=name
        ).exclude(pk=category.pk).exists():
            raise ValidationError({"name": ["A component category with this name already exists."]})
        category = services.update_component_category(
            category=category, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ComponentCategorySerializer(category).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a component category (requires category.manage; its components become uncategorized)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        category = get_object_or_404(ComponentCategory, pk=pk, organization=request.user.organization)
        services.delete_component_category(category=category, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class StorageLocationListView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("category.manage")()]
        return [require_permission("component.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List workshop storage locations",
        responses={200: StorageLocationSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = StorageLocation.objects.filter(organization=request.user.organization).annotate(
            component_count=Count("components")
        )
        return paginated_response(request, queryset, StorageLocationSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create a storage location (requires category.manage)",
        request=StorageLocationWriteSerializer,
        responses={201: StorageLocationSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = StorageLocationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if StorageLocation.objects.filter(
            organization=request.user.organization, name__iexact=serializer.validated_data["name"].strip()
        ).exists():
            raise ValidationError({"name": ["A location with this name already exists."]})
        location = services.create_storage_location(actor=request.user, request=request, **serializer.validated_data)
        return Response(StorageLocationSerializer(location).data, status=status.HTTP_201_CREATED)


class StorageLocationDetailView(APIView):
    permission_classes = [require_permission("category.manage")]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "Rename/update a storage location (requires category.manage). Renaming it to another location's "
            "name merges the two - the returned location is the one that remains."
        ),
        request=StorageLocationWriteSerializer,
        responses={200: StorageLocationSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        location = get_object_or_404(StorageLocation, pk=pk, organization=request.user.organization)
        serializer = StorageLocationWriteSerializer(location, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        location = services.update_storage_location(
            location=location, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(StorageLocationSerializer(location).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a storage location (requires category.manage; its components lose their location)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        location = get_object_or_404(StorageLocation, pk=pk, organization=request.user.organization)
        services.delete_storage_location(location=location, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ComponentDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("component.update")()]
        if self.request.method == "DELETE":
            return [require_permission("component.delete")()]
        return [require_permission("component.read")()]

    @extend_schema(
        tags=["Engineering"], summary="Get a component", responses={200: ComponentDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def get(self, request, pk):
        component = _visible_component_or_404(request, pk)
        return Response(ComponentDetailSerializer(component, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a component (requires component.update)",
        request=ComponentWriteSerializer,
        responses={200: ComponentDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        component = get_object_or_404(Component, pk=pk, organization=request.user.organization)
        serializer = ComponentWriteSerializer(component, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        component = services.update_component(
            component=component, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(ComponentDetailSerializer(component).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a component (requires component.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        component = get_object_or_404(Component, pk=pk, organization=request.user.organization)
        services.delete_component(component=component, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ComponentRelationsView(APIView):
    permission_classes = [require_permission("component.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List a component's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        component = _visible_component_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Component)
        relations = services.get_relations_for("component", component.id, actor=request.user)
        return Response(
            KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, component.id)}).data
        )


class ComponentAttachmentListView(APIView):
    permission_classes = [require_permission("component.read")]

    @extend_schema(
        tags=["Engineering"], summary="List a component's attachments",
        responses={200: ComponentAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        component = _visible_component_or_404(request, pk)
        return Response(
            ComponentAttachmentSerializer(component.attachments.select_related("file", "uploaded_by"), many=True).data
        )

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a component (requires component.update)",
        request=AddAttachmentSerializer,
        responses={201: ComponentAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        component = get_object_or_404(Component, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_component_attachment(component=component, file=file, actor=request.user, request=request)
        return Response(ComponentAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class ComponentAttachmentDetailView(APIView):
    permission_classes = [require_permission("component.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a component attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(ComponentAttachment, pk=attachment_pk, component_id=pk, component__organization=request.user.organization)
        services.remove_component_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


FAILURE_ORDERING_FIELDS = {
    "title": "title",
    "component": "component__name",
    "project": "project__name",
    "aircraft": "aircraft",
    "date": "date",
    "severity": "severity",
    "status": "status",
    "visibility": "visibility",
    "created_at": "created_at",
    "updated_at": "updated_at",
}


class FailureListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("failure.create")()]
        return [require_permission("failure.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "List failure reports (optional ?severity=, ?status=, ?q=<search title/summary/root cause>, "
            "?ordering=<field, \"-\"-prefixed for descending - see FAILURE_ORDERING_FIELDS>)"
        ),
        responses={200: FailureListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_failures_for(request.user).select_related(
            "component", "project", "created_by"
        )
        severity = request.query_params.get("severity")
        if severity:
            queryset = queryset.filter(severity=severity)
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = search.search_filter(queryset, query, "failure")
        queryset = apply_ordering(queryset, request, FAILURE_ORDERING_FIELDS)
        return paginated_response(request, queryset, FailureListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Report a failure",
        request=FailureWriteSerializer,
        responses={201: FailureDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = FailureWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        failure = services.create_failure(actor=request.user, request=request, **serializer.validated_data)
        return Response(FailureDetailSerializer(failure).data, status=status.HTTP_201_CREATED)


class FailureDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("failure.update")()]
        if self.request.method == "DELETE":
            return [require_permission("failure.delete")()]
        return [require_permission("failure.read")()]

    @extend_schema(
        tags=["Engineering"], summary="Get a failure report", responses={200: FailureDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def get(self, request, pk):
        failure = _visible_failure_or_404(request, pk)
        return Response(FailureDetailSerializer(failure, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a failure report (requires failure.update)",
        request=FailureWriteSerializer,
        responses={200: FailureDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        failure = get_object_or_404(Failure, pk=pk, organization=request.user.organization)
        serializer = FailureWriteSerializer(failure, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        failure = services.update_failure(failure=failure, actor=request.user, request=request, **serializer.validated_data)
        return Response(FailureDetailSerializer(failure).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a failure report (requires failure.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        failure = get_object_or_404(Failure, pk=pk, organization=request.user.organization)
        services.delete_failure(failure=failure, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FailureRelationsView(APIView):
    permission_classes = [require_permission("failure.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List a failure report's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        failure = _visible_failure_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Failure)
        relations = services.get_relations_for("failure", failure.id, actor=request.user)
        return Response(
            KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, failure.id)}).data
        )


class FailureAttachmentListView(APIView):
    permission_classes = [require_permission("failure.read")]

    @extend_schema(
        tags=["Engineering"], summary="List a failure report's attachments",
        responses={200: FailureAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        failure = _visible_failure_or_404(request, pk)
        return Response(FailureAttachmentSerializer(failure.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a failure report (requires failure.update)",
        request=AddAttachmentSerializer,
        responses={201: FailureAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        failure = get_object_or_404(Failure, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_failure_attachment(failure=failure, file=file, actor=request.user, request=request)
        return Response(FailureAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class FailureAttachmentDetailView(APIView):
    permission_classes = [require_permission("failure.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a failure report attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(FailureAttachment, pk=attachment_pk, failure_id=pk, failure__organization=request.user.organization)
        services.remove_failure_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SopListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("sop.create")()]
        return [require_permission("sop.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List SOPs (optional ?category=<id>, ?mandatory=true, ?q=<search title/content>)",
        responses={200: SopListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_sops_for(request.user).select_related(
            "category", "created_by"
        ).prefetch_related("tags")
        category_id = request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        if request.query_params.get("mandatory") == "true":
            queryset = queryset.filter(mandatory=True)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = search.search_filter(queryset, query, "sop")
        return paginated_response(request, queryset, SopListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create an SOP",
        request=SopWriteSerializer,
        responses={201: SopDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = SopWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sop = services.create_sop(actor=request.user, request=request, **serializer.validated_data)
        return Response(SopDetailSerializer(sop).data, status=status.HTTP_201_CREATED)


class SopDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("sop.update")()]
        if self.request.method == "DELETE":
            return [require_permission("sop.delete")()]
        return [require_permission("sop.read")()]

    @extend_schema(tags=["Engineering"], summary="Get an SOP", responses={200: SopDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS})
    def get(self, request, pk):
        sop = _visible_sop_or_404(request, pk)
        return Response(SopDetailSerializer(sop, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update an SOP (requires sop.update)",
        request=SopWriteSerializer,
        responses={200: SopDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk, organization=request.user.organization)
        serializer = SopWriteSerializer(sop, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        sop = services.update_sop(sop=sop, actor=request.user, request=request, **serializer.validated_data)
        return Response(SopDetailSerializer(sop).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete an SOP (requires sop.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk, organization=request.user.organization)
        services.delete_sop(sop=sop, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SopRelationsView(APIView):
    permission_classes = [require_permission("sop.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List an SOP's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        sop = _visible_sop_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Sop)
        relations = services.get_relations_for("sop", sop.id, actor=request.user)
        return Response(KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, sop.id)}).data)


class SopAttachmentListView(APIView):
    permission_classes = [require_permission("sop.read")]

    @extend_schema(
        tags=["Engineering"], summary="List an SOP's attachments",
        responses={200: SopAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        sop = _visible_sop_or_404(request, pk)
        return Response(SopAttachmentSerializer(sop.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to an SOP (requires sop.update)",
        request=AddAttachmentSerializer,
        responses={201: SopAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_sop_attachment(sop=sop, file=file, actor=request.user, request=request)
        return Response(SopAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class SopAttachmentDetailView(APIView):
    permission_classes = [require_permission("sop.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove an SOP attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(SopAttachment, pk=attachment_pk, sop_id=pk, sop__organization=request.user.organization)
        services.remove_sop_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


TEST_ORDERING_FIELDS = {
    "title": "title",
    "test_type": "test_type",
    "date": "date",
    "location": "location",
    "project": "project__name",
    "status": "status",
    "pass_fail": "pass_fail",
    "visibility": "visibility",
    "created_at": "created_at",
    "updated_at": "updated_at",
}


class TestListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("test.create")()]
        return [require_permission("test.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "List tests (optional ?test_type=, ?status=, ?pass_fail=, ?q=<search title/objective/results/"
            "conclusion>, ?ordering=<field, \"-\"-prefixed for descending - see TEST_ORDERING_FIELDS>)"
        ),
        responses={200: TestListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_tests_for(request.user).select_related(
            "project", "created_by"
        ).prefetch_related("tags")
        test_type = request.query_params.get("test_type")
        if test_type:
            queryset = queryset.filter(test_type=test_type)
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        pass_fail = request.query_params.get("pass_fail")
        if pass_fail:
            queryset = queryset.filter(pass_fail=pass_fail)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = search.search_filter(queryset, query, "test")
        queryset = apply_ordering(queryset, request, TEST_ORDERING_FIELDS)
        return paginated_response(request, queryset, TestListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Record a test/experiment",
        request=TestWriteSerializer,
        responses={201: TestDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = TestWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        test = services.create_test(actor=request.user, request=request, **serializer.validated_data)
        return Response(TestDetailSerializer(test).data, status=status.HTTP_201_CREATED)


class TestDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("test.update")()]
        if self.request.method == "DELETE":
            return [require_permission("test.delete")()]
        return [require_permission("test.read")()]

    @extend_schema(
        tags=["Engineering"], summary="Get a test", responses={200: TestDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS}
    )
    def get(self, request, pk):
        test = _visible_test_or_404(request, pk)
        return Response(TestDetailSerializer(test, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a test (requires test.update)",
        request=TestWriteSerializer,
        responses={200: TestDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        test = get_object_or_404(Test, pk=pk, organization=request.user.organization)
        serializer = TestWriteSerializer(test, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        test = services.update_test(test=test, actor=request.user, request=request, **serializer.validated_data)
        return Response(TestDetailSerializer(test).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a test (requires test.delete)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        test = get_object_or_404(Test, pk=pk, organization=request.user.organization)
        services.delete_test(test=test, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TestRelationsView(APIView):
    permission_classes = [require_permission("test.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List a test's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        test = _visible_test_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Test)
        relations = services.get_relations_for("test", test.id, actor=request.user)
        return Response(KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, test.id)}).data)


class TestAttachmentListView(APIView):
    permission_classes = [require_permission("test.read")]

    @extend_schema(
        tags=["Engineering"], summary="List a test's attachments",
        responses={200: TestAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        test = _visible_test_or_404(request, pk)
        return Response(TestAttachmentSerializer(test.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a test (requires test.update)",
        request=AddAttachmentSerializer,
        responses={201: TestAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        test = get_object_or_404(Test, pk=pk, organization=request.user.organization)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"], organization=request.user.organization)
        attachment = services.add_test_attachment(test=test, file=file, actor=request.user, request=request)
        return Response(TestAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class TestAttachmentDetailView(APIView):
    permission_classes = [require_permission("test.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a test attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(TestAttachment, pk=attachment_pk, test_id=pk, test__organization=request.user.organization)
        services.remove_test_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _visible_document_or_404(request, pk):
    queryset = Document.objects.select_related("category", "created_by", "file")
    return _visible_instance_or_404(request, queryset, "document", pk)


DOCUMENT_ORDERING_FIELDS = {
    "title": "title",
    "doc_type": "doc_type",
    "source": "source",
    "category": "category__name",
    "publication_date": "publication_date",
    "created_at": "created_at",
    "updated_at": "updated_at",
}


class DocumentListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("document.create")()]
        return [require_permission("document.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary=(
            "List documents (optional ?doc_type=, ?source=, ?category=, ?q=<search title/description>, "
            "?ordering=<field, \"-\"-prefixed for descending - see DOCUMENT_ORDERING_FIELDS>)"
        ),
        responses={200: DocumentListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = services.visible_documents_for(request.user).select_related(
            "category", "created_by", "file"
        ).prefetch_related("tags")
        doc_type = request.query_params.get("doc_type")
        if doc_type:
            queryset = queryset.filter(doc_type=doc_type)
        source = request.query_params.get("source")
        if source:
            queryset = queryset.filter(source=source)
        category = request.query_params.get("category")
        if category:
            queryset = queryset.filter(category_id=category)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = search.search_filter(queryset, query, "document")
        queryset = apply_ordering(queryset, request, DOCUMENT_ORDERING_FIELDS)
        return paginated_response(request, queryset, DocumentListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Add a document/resource (requires document.create)",
        request=DocumentWriteSerializer,
        responses={201: DocumentDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = DocumentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = services.create_document(actor=request.user, request=request, **serializer.validated_data)
        return Response(DocumentDetailSerializer(document).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [require_permission("document.read")()]
        return [require_permission("document.create")()]

    @extend_schema(
        tags=["Engineering"],
        summary="Get a document (own, RESTRICTED-excluded unless created_by/document.update, else document.read)",
        responses={200: DocumentDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        document = _visible_document_or_404(request, pk)
        return Response(DocumentDetailSerializer(document, context={"request": request}).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a document (own, or requires document.update)",
        request=DocumentWriteSerializer,
        responses={200: DocumentDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        document = get_object_or_404(Document, pk=pk, organization=request.user.organization)
        serializer = DocumentWriteSerializer(document, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        document = services.update_document(
            document=document, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(DocumentDetailSerializer(document).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Delete a document (own, or requires document.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        document = get_object_or_404(Document, pk=pk, organization=request.user.organization)
        services.delete_document(document=document, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentRelationsView(APIView):
    permission_classes = [require_permission("document.read")]

    @extend_schema(
        tags=["Engineering"],
        summary="List a document's related content",
        responses={200: KnowledgeRelationSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        document = _visible_document_or_404(request, pk)
        content_type = ContentType.objects.get_for_model(Document)
        relations = services.get_relations_for("document", document.id, actor=request.user)
        return Response(
            KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, document.id)}).data
        )


class AccessGrantListCreateView(APIView):
    """Grants a specific org member access to one RESTRICTED item. There's
    no GET-list here - who already has access is read off the item's own
    Detail endpoint (`restricted_to`, via RestrictedAccessMixin) rather than
    a second round trip."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Grant a specific org member access to a RESTRICTED item (requires edit rights on the item)",
        request=CreateAccessGrantSerializer,
        responses={201: AccessGrantSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CreateAccessGrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grant = services.add_restricted_access(actor=request.user, request=request, **serializer.validated_data)
        return Response(AccessGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class AccessGrantDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Revoke a previously granted RESTRICTED-item access",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        # knowledge-app targets only - a grant on a training.Course is managed
        # through training's own course access-grant endpoint, under
        # training's permission rules rather than knowledge's.
        grant = get_object_or_404(
            RestrictedAccessGrant,
            pk=pk,
            organization=request.user.organization,
            content_type__app_label="knowledge",
        )
        services.remove_restricted_access(grant=grant, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrgMembersListView(APIView):
    """Every user in the caller's org, for the RESTRICTED-access people-
    picker - deliberately IsAuthenticated only (not user.manage, which
    rbac.UserListView requires), since any Member creating a RESTRICTED
    item needs to be able to pick grantees for it. Shaped like
    AuthorSerializer (no roles/permissions) for the same reason
    AuthorSerializer never exposes those to a plain content viewer."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List the caller's organization members (for picking who to grant RESTRICTED access to)",
        responses={200: AuthorSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        members = User.objects.filter(organization=request.user.organization).order_by(
            "first_name", "last_name", "email"
        )
        return paginated_response(request, members, AuthorSerializer)


class BookmarkListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="List the caller's own bookmarks (optional ?type=<content type>)",
        responses={200: BookmarkSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        content_type_name = request.query_params.get("type")
        bookmarks = services.bookmarks_for(request.user, content_type_name).select_related("content_type")
        return paginated_response(request, bookmarks, BookmarkSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Bookmark a piece of content",
        request=CreateBookmarkSerializer,
        responses={201: BookmarkSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CreateBookmarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        bookmark = services.create_bookmark(actor=request.user, request=request, **serializer.validated_data)
        return Response(BookmarkSerializer(bookmark).data, status=status.HTTP_201_CREATED)


class BookmarkDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary="Remove one of the caller's own bookmarks",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        bookmark = get_object_or_404(Bookmark, pk=pk, user=request.user)
        services.delete_bookmark(bookmark=bookmark, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
