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
    KnowledgeRelation,
    Question,
    QuestionAttachment,
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
    CreateRelationSerializer,
    KnowledgeRelationSerializer,
    QuestionAttachmentSerializer,
    QuestionDetailSerializer,
    QuestionListSerializer,
    QuestionWriteSerializer,
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
            "Search articles and questions (?q=; optional ?type=article|question to scope to one "
            "section; ?page= for 20-per-type pages within that scope)"
        ),
        responses={
            200: OpenApiResponse(description="{'results': [{type, id, title, excerpt}, ...], 'has_more': bool}"),
            **COMMON_ERRORS,
        },
    )
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        scope = request.query_params.get("type") or None
        if scope not in (None, "article", "question"):
            raise ValidationError("type must be 'article' or 'question'.")
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            raise ValidationError("page must be an integer.")
        offset = (page - 1) * 20

        # Each type is paginated independently (offset/limit per type, not
        # across the combined list) - simplest thing that supports "page 2 of
        # articles" and "page 2 of questions" without a shared cursor across
        # two different querysets. has_more is True only for whichever
        # type(s) actually have more rows past this page.
        results = []
        has_more = False
        if query and scope in (None, "article"):
            article_qs = (
                Article.objects.filter(status=Article.Status.PUBLISHED)
                .filter(Q(title__icontains=query) | Q(excerpt__icontains=query) | Q(content__icontains=query))
                .order_by("-updated_at")
            )
            articles = article_qs[offset : offset + 20]
            has_more = has_more or article_qs[offset + 20 : offset + 21].exists()
            results += [
                {"type": "article", "id": str(article.id), "title": article.title, "excerpt": article.excerpt}
                for article in articles
            ]
        if query and scope in (None, "question"):
            question_qs = Question.objects.filter(Q(title__icontains=query) | Q(body__icontains=query)).order_by(
                "-updated_at"
            )
            questions = question_qs[offset : offset + 20]
            has_more = has_more or question_qs[offset + 20 : offset + 21].exists()
            results += [
                {"type": "question", "id": str(question.id), "title": question.title, "excerpt": question.body[:200]}
                for question in questions
            ]
        return Response({"results": results, "has_more": has_more})


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
