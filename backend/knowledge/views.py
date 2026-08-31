from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import paginated_response
from files.models import StoredFile
from rbac.permissions import require_permission

from . import services
from .models import (
    Answer,
    Article,
    ArticleAttachment,
    Category,
    Component,
    ComponentAttachment,
    Failure,
    FailureAttachment,
    KnowledgeRelation,
    Project,
    ProjectAttachment,
    Question,
    QuestionAttachment,
    Sop,
    SopAttachment,
    Tag,
    Visibility,
)
from .serializers import (
    AcceptAnswerSerializer,
    AddAttachmentSerializer,
    AnswerSerializer,
    AnswerWriteSerializer,
    ArticleAttachmentSerializer,
    ArticleDetailSerializer,
    ArticleListSerializer,
    ArticleRevisionSerializer,
    ArticleWriteSerializer,
    CategorySerializer,
    CategoryWriteSerializer,
    ComponentAttachmentSerializer,
    ComponentDetailSerializer,
    ComponentListSerializer,
    ComponentWriteSerializer,
    CreateRelationSerializer,
    FailureAttachmentSerializer,
    FailureDetailSerializer,
    FailureListSerializer,
    FailureWriteSerializer,
    KnowledgeRelationSerializer,
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
    TagSerializer,
    TagWriteSerializer,
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
        return paginated_response(request, Category.objects.all(), CategorySerializer)

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
        category = get_object_or_404(Category, pk=pk)
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
        category = get_object_or_404(Category, pk=pk)
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
        tags = Tag.objects.annotate(
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
        tag = get_object_or_404(Tag, pk=pk)
        services.delete_tag(tag=tag, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SearchView(APIView):
    """Simple icontains search across published articles and questions - no
    ranking/scoring, Postgres full-text search, or category/tag-name
    matching yet (see docs/VISION.md #12's fuller sketch). Good enough for
    the current content volume; swap the queryset for a SearchVector-based
    one if/when result quality matters more than simplicity."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["Knowledge"],
        summary=(
            "Search across articles, questions, projects, components, failures, and SOPs "
            "(?q=; optional ?type=<one of those> to scope to one section; ?sort=newest|oldest, "
            "default newest; ?page= for 20-per-type pages within that scope)"
        ),
        responses={
            200: OpenApiResponse(
                description=(
                    "{'results': [{type, id, title, excerpt}, ...], 'has_more': bool, "
                    "'counts': {article, question, project, component, failure, sop: int}} - counts "
                    "reflect the query across every type regardless of ?type=, so the UI can show "
                    "per-type totals for a filter list."
                )
            ),
            **COMMON_ERRORS,
        },
    )
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        scope = request.query_params.get("type") or None
        valid_types = ("article", "question", "project", "component", "failure", "sop")
        if scope not in (None, *valid_types):
            raise ValidationError(f"type must be one of {', '.join(valid_types)}.")
        sort_param = request.query_params.get("sort", "newest")
        if sort_param not in ("newest", "oldest"):
            raise ValidationError("sort must be 'newest' or 'oldest'.")
        order = "-updated_at" if sort_param == "newest" else "updated_at"
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            raise ValidationError("page must be an integer.")
        offset = (page - 1) * 20

        # Built regardless of `scope` - counts below need the unscoped totals
        # even when the caller is only viewing one type's results. Engineering-
        # domain types have no `status`/`visibility` gate (see models.py) - a
        # matching row is a matching row.
        can_review_articles = request.user.has_permission("article.review") or request.user.has_permission(
            "article.publish"
        )
        article_matches = (
            Article.objects.filter(status=Article.Status.PUBLISHED).filter(
                Q(title__icontains=query) | Q(excerpt__icontains=query) | Q(content__icontains=query)
            )
            if query
            else Article.objects.none()
        )
        if query and not can_review_articles:
            # Same RESTRICTED-visibility gate as ArticleListCreateView.get -
            # otherwise a RESTRICTED article's title/excerpt would leak into
            # search results for viewers who couldn't open it (_visible_article_or_404).
            article_matches = article_matches.exclude(Q(visibility=Visibility.RESTRICTED) & ~Q(author=request.user))
        question_matches = (
            Question.objects.filter(Q(title__icontains=query) | Q(body__icontains=query))
            if query
            else Question.objects.none()
        )
        if query and not request.user.has_permission("question.moderate"):
            # Same RESTRICTED-visibility gate as QuestionListCreateView.get -
            # otherwise a RESTRICTED question's title/body excerpt would leak
            # into search results for viewers who couldn't open it (_visible_question_or_404).
            question_matches = question_matches.exclude(Q(visibility=Visibility.RESTRICTED) & ~Q(author=request.user))
        project_matches = (
            Project.objects.filter(Q(name__icontains=query) | Q(description__icontains=query))
            if query
            else Project.objects.none()
        )
        component_matches = (
            Component.objects.filter(
                Q(name__icontains=query)
                | Q(summary__icontains=query)
                | Q(manufacturer__icontains=query)
                | Q(part_number__icontains=query)
            )
            if query
            else Component.objects.none()
        )
        failure_matches = (
            Failure.objects.filter(Q(title__icontains=query) | Q(summary__icontains=query) | Q(root_cause__icontains=query))
            if query
            else Failure.objects.none()
        )
        sop_matches = (
            Sop.objects.filter(Q(title__icontains=query) | Q(content__icontains=query)) if query else Sop.objects.none()
        )
        counts = {
            "article": article_matches.count(),
            "question": question_matches.count(),
            "project": project_matches.count(),
            "component": component_matches.count(),
            "failure": failure_matches.count(),
            "sop": sop_matches.count(),
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
            if not (query and scope in (None, type_name)):
                return
            page_qs = matches.order_by(order)
            rows = page_qs[offset : offset + 20]
            has_more = has_more or page_qs[offset + 20 : offset + 21].exists()
            for row in rows:
                excerpt = excerpt_source(row) if callable(excerpt_source) else getattr(row, excerpt_source, "")
                results.append(
                    {"type": type_name, "id": str(row.id), "title": getattr(row, title_field), "excerpt": (excerpt or "")[:200]}
                )

        collect("article", article_matches, "title", "excerpt")
        collect("question", question_matches, "title", lambda q: q.body[:200])
        collect("project", project_matches, "name", "description")
        collect("component", component_matches, "name", "summary")
        collect("failure", failure_matches, "title", "summary")
        collect("sop", sop_matches, "title", "content")

        return Response({"results": results, "has_more": has_more, "counts": counts})


def _visible_article_or_404(request, pk):
    article = get_object_or_404(Article.objects.select_related("category", "author"), pk=pk)
    is_privileged = (
        request.user == article.author
        or request.user.has_permission("article.review")
        or request.user.has_permission("article.publish")
    )
    # PUBLISHED + not RESTRICTED is the common "anyone with article.read" case;
    # everything else (still in DRAFT/IN_REVIEW/etc, or explicitly RESTRICTED
    # even though published) requires being the author or a reviewer/publisher.
    if article.status == Article.Status.PUBLISHED and article.visibility != Visibility.RESTRICTED:
        return article
    if is_privileged:
        return article
    raise PermissionDenied("This article isn't accessible to you.")


def _visible_question_or_404(request, pk):
    question = get_object_or_404(
        Question.objects.select_related("author").prefetch_related("tags", "answers__author"), pk=pk
    )
    if question.visibility != Visibility.RESTRICTED:
        return question
    if request.user == question.author or request.user.has_permission("question.moderate"):
        return question
    raise PermissionDenied("This question isn't accessible to you.")


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
        queryset = Article.objects.select_related("category", "author").prefetch_related("tags")
        can_review = request.user.has_permission("article.review") or request.user.has_permission("article.publish")
        if status_param == "ALL":
            # A reviewer/publisher sees every article regardless of status -
            # no further filtering needed. Everyone else sees every
            # published article they'd normally see (still excluding
            # RESTRICTED ones that aren't theirs) plus their own articles in
            # any other status, since those aren't discoverable by anyone else.
            if not can_review:
                queryset = queryset.filter(Q(status=Article.Status.PUBLISHED) | Q(author=request.user))
                queryset = queryset.exclude(
                    Q(status=Article.Status.PUBLISHED)
                    & Q(visibility=Visibility.RESTRICTED)
                    & ~Q(author=request.user)
                )
        elif status_param == Article.Status.PUBLISHED:
            queryset = queryset.filter(status=Article.Status.PUBLISHED)
            if not can_review:
                queryset = queryset.exclude(Q(visibility=Visibility.RESTRICTED) & ~Q(author=request.user))
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
        return Response(ArticleDetailSerializer(article).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Update an article (own draft/in-review, or requires article.update)",
        request=ArticleWriteSerializer,
        responses={200: ArticleDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
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
        questions = Question.objects.select_related("author").prefetch_related("tags", "answers")
        status_param = request.query_params.get("status")
        if status_param:
            questions = questions.filter(status=status_param)
        if not request.user.has_permission("question.moderate"):
            questions = questions.exclude(Q(visibility=Visibility.RESTRICTED) & ~Q(author=request.user))
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
        return Response(QuestionDetailSerializer(question).data)

    @extend_schema(
        tags=["Knowledge"],
        summary="Update a question (own, or requires question.moderate)",
        request=QuestionWriteSerializer,
        responses={200: QuestionDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        question = get_object_or_404(Question, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
        return paginated_response(request, question.answers.select_related("author"), AnswerSerializer)

    @extend_schema(
        tags=["Knowledge"],
        summary="Answer a question",
        request=AnswerWriteSerializer,
        responses={201: AnswerSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        question = get_object_or_404(Question, pk=pk)
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
        answer = get_object_or_404(Answer, pk=pk)
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
        answer = get_object_or_404(Answer, pk=pk)
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
        question = get_object_or_404(Question, pk=pk)
        serializer = AcceptAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answer_id = serializer.validated_data["answer_id"]
        answer = get_object_or_404(Answer, pk=answer_id) if answer_id else None
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
        relations = services.get_relations_for("article", article.id)
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
        relations = services.get_relations_for("question", question.id)
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
        relation = get_object_or_404(KnowledgeRelation, pk=pk)
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
        article = get_object_or_404(Article, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
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
        attachment = get_object_or_404(ArticleAttachment, pk=attachment_pk, article_id=pk)
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
        question = get_object_or_404(Question, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
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
        attachment = get_object_or_404(QuestionAttachment, pk=attachment_pk, question_id=pk)
        services.remove_question_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Engineering domain (Project/Component/Failure/Sop) --------------------
#
# No visibility field and no draft/review workflow (see models.py) - so
# unlike Article/Question there's no _visible_x_or_404 helper needed here;
# get_object_or_404 plus the x.read/x.update/x.delete permission per method
# is the whole access-control story.


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
        queryset = Project.objects.prefetch_related("tags").select_related("created_by")
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(description__icontains=query))
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
        project = get_object_or_404(Project, pk=pk)
        return Response(ProjectDetailSerializer(project).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a project (requires project.update)",
        request=ProjectWriteSerializer,
        responses={200: ProjectDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        project = get_object_or_404(Project, pk=pk)
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
        project = get_object_or_404(Project, pk=pk)
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
        project = get_object_or_404(Project, pk=pk)
        content_type = ContentType.objects.get_for_model(Project)
        relations = services.get_relations_for("project", project.id)
        return Response(KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, project.id)}).data)


class ProjectAttachmentListView(APIView):
    permission_classes = [require_permission("project.read")]

    @extend_schema(
        tags=["Engineering"], summary="List a project's attachments",
        responses={200: ProjectAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        project = get_object_or_404(Project, pk=pk)
        return Response(ProjectAttachmentSerializer(project.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a project (requires project.update)",
        request=AddAttachmentSerializer,
        responses={201: ProjectAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        project = get_object_or_404(Project, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
        attachment = services.add_project_attachment(project=project, file=file, actor=request.user, request=request)
        return Response(ProjectAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class ProjectAttachmentDetailView(APIView):
    permission_classes = [require_permission("project.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a project attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(ProjectAttachment, pk=attachment_pk, project_id=pk)
        services.remove_project_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ComponentListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("component.create")()]
        return [require_permission("component.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List components (optional ?category=<id>, ?status=, ?q=<search name/summary/manufacturer/part number>)",
        responses={200: ComponentListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = Component.objects.select_related("category", "created_by").prefetch_related("tags")
        category_id = request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(summary__icontains=query)
                | Q(manufacturer__icontains=query)
                | Q(part_number__icontains=query)
            )
        return paginated_response(request, queryset, ComponentListSerializer)

    @extend_schema(
        tags=["Engineering"],
        summary="Create a component",
        request=ComponentWriteSerializer,
        responses={201: ComponentDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = ComponentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        component = services.create_component(actor=request.user, request=request, **serializer.validated_data)
        return Response(ComponentDetailSerializer(component).data, status=status.HTTP_201_CREATED)


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
        component = get_object_or_404(Component, pk=pk)
        return Response(ComponentDetailSerializer(component).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a component (requires component.update)",
        request=ComponentWriteSerializer,
        responses={200: ComponentDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        component = get_object_or_404(Component, pk=pk)
        serializer = ComponentWriteSerializer(component, data=request.data, partial=True)
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
        component = get_object_or_404(Component, pk=pk)
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
        component = get_object_or_404(Component, pk=pk)
        content_type = ContentType.objects.get_for_model(Component)
        relations = services.get_relations_for("component", component.id)
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
        component = get_object_or_404(Component, pk=pk)
        return Response(
            ComponentAttachmentSerializer(component.attachments.select_related("file", "uploaded_by"), many=True).data
        )

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a component (requires component.update)",
        request=AddAttachmentSerializer,
        responses={201: ComponentAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        component = get_object_or_404(Component, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
        attachment = services.add_component_attachment(component=component, file=file, actor=request.user, request=request)
        return Response(ComponentAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class ComponentAttachmentDetailView(APIView):
    permission_classes = [require_permission("component.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a component attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(ComponentAttachment, pk=attachment_pk, component_id=pk)
        services.remove_component_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FailureListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("failure.create")()]
        return [require_permission("failure.read")()]

    @extend_schema(
        tags=["Engineering"],
        summary="List failure reports (optional ?severity=, ?status=, ?q=<search title/summary/root cause>)",
        responses={200: FailureListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = Failure.objects.select_related("component", "project", "created_by")
        severity = request.query_params.get("severity")
        if severity:
            queryset = queryset.filter(severity=severity)
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(
                Q(title__icontains=query) | Q(summary__icontains=query) | Q(root_cause__icontains=query)
            )
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
        failure = get_object_or_404(Failure, pk=pk)
        return Response(FailureDetailSerializer(failure).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update a failure report (requires failure.update)",
        request=FailureWriteSerializer,
        responses={200: FailureDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        failure = get_object_or_404(Failure, pk=pk)
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
        failure = get_object_or_404(Failure, pk=pk)
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
        failure = get_object_or_404(Failure, pk=pk)
        content_type = ContentType.objects.get_for_model(Failure)
        relations = services.get_relations_for("failure", failure.id)
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
        failure = get_object_or_404(Failure, pk=pk)
        return Response(FailureAttachmentSerializer(failure.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to a failure report (requires failure.update)",
        request=AddAttachmentSerializer,
        responses={201: FailureAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        failure = get_object_or_404(Failure, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
        attachment = services.add_failure_attachment(failure=failure, file=file, actor=request.user, request=request)
        return Response(FailureAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class FailureAttachmentDetailView(APIView):
    permission_classes = [require_permission("failure.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove a failure report attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(FailureAttachment, pk=attachment_pk, failure_id=pk)
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
        queryset = Sop.objects.select_related("category", "created_by").prefetch_related("tags")
        category_id = request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        if request.query_params.get("mandatory") == "true":
            queryset = queryset.filter(mandatory=True)
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(Q(title__icontains=query) | Q(content__icontains=query))
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
        sop = get_object_or_404(Sop, pk=pk)
        return Response(SopDetailSerializer(sop).data)

    @extend_schema(
        tags=["Engineering"],
        summary="Update an SOP (requires sop.update)",
        request=SopWriteSerializer,
        responses={200: SopDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk)
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
        sop = get_object_or_404(Sop, pk=pk)
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
        sop = get_object_or_404(Sop, pk=pk)
        content_type = ContentType.objects.get_for_model(Sop)
        relations = services.get_relations_for("sop", sop.id)
        return Response(KnowledgeRelationSerializer(relations, many=True, context={"viewer": (content_type, sop.id)}).data)


class SopAttachmentListView(APIView):
    permission_classes = [require_permission("sop.read")]

    @extend_schema(
        tags=["Engineering"], summary="List an SOP's attachments",
        responses={200: SopAttachmentSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk)
        return Response(SopAttachmentSerializer(sop.attachments.select_related("file", "uploaded_by"), many=True).data)

    @extend_schema(
        tags=["Engineering"], summary="Attach an already-uploaded file to an SOP (requires sop.update)",
        request=AddAttachmentSerializer,
        responses={201: SopAttachmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        sop = get_object_or_404(Sop, pk=pk)
        serializer = AddAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file = get_object_or_404(StoredFile, pk=serializer.validated_data["file_id"])
        attachment = services.add_sop_attachment(sop=sop, file=file, actor=request.user, request=request)
        return Response(SopAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


class SopAttachmentDetailView(APIView):
    permission_classes = [require_permission("sop.update")]

    @extend_schema(
        tags=["Engineering"], summary="Remove an SOP attachment",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, attachment_pk):
        attachment = get_object_or_404(SopAttachment, pk=attachment_pk, sop_id=pk)
        services.remove_sop_attachment(attachment=attachment, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
