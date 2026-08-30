from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from rbac.permissions import require_permission

from . import services
from .models import Answer, Article, Category, Question, Tag
from .serializers import (
    AcceptAnswerSerializer,
    AnswerSerializer,
    AnswerWriteSerializer,
    ArticleDetailSerializer,
    ArticleListSerializer,
    ArticleRevisionSerializer,
    ArticleWriteSerializer,
    CategorySerializer,
    CategoryWriteSerializer,
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
        return Response(CategorySerializer(Category.objects.all(), many=True).data)

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
        return Response(TagSerializer(tags, many=True).data)

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
        summary="Search articles and questions (?q=; optional ?type=article|question to scope to one section)",
        responses={200: OpenApiResponse(description="{'results': [{type, id, title, excerpt}, ...]}"), **COMMON_ERRORS},
    )
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        scope = request.query_params.get("type") or None
        if scope not in (None, "article", "question"):
            raise ValidationError("type must be 'article' or 'question'.")

        results = []
        if query and scope in (None, "article"):
            articles = (
                Article.objects.filter(status=Article.Status.PUBLISHED)
                .filter(Q(title__icontains=query) | Q(excerpt__icontains=query) | Q(content__icontains=query))
                .order_by("-updated_at")[:20]
            )
            results += [
                {"type": "article", "id": str(article.id), "title": article.title, "excerpt": article.excerpt}
                for article in articles
            ]
        if query and scope in (None, "question"):
            questions = (
                Question.objects.filter(Q(title__icontains=query) | Q(body__icontains=query))
                .order_by("-updated_at")[:20]
            )
            results += [
                {"type": "question", "id": str(question.id), "title": question.title, "excerpt": question.body[:200]}
                for question in questions
            ]
        return Response({"results": results})


def _visible_article_or_404(request, pk):
    article = get_object_or_404(Article.objects.select_related("category", "author"), pk=pk)
    if article.status == Article.Status.PUBLISHED:
        return article
    if request.user == article.author:
        return article
    if request.user.has_permission("article.review") or request.user.has_permission("article.publish"):
        return article
    raise PermissionDenied("This article isn't published yet.")


class ArticleListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("article.create")()]
        return [require_permission("article.read")()]

    @extend_schema(
        tags=["Knowledge"],
        summary="List articles (published by default; ?status= for other states, own-authored or reviewer/publisher only)",
        responses={200: ArticleListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        status_param = request.query_params.get("status", Article.Status.PUBLISHED)
        queryset = Article.objects.select_related("category", "author").prefetch_related("tags")
        if status_param == Article.Status.PUBLISHED:
            queryset = queryset.filter(status=Article.Status.PUBLISHED)
        elif request.user.has_permission("article.review") or request.user.has_permission("article.publish"):
            queryset = queryset.filter(status=status_param)
        else:
            queryset = queryset.filter(status=status_param, author=request.user)
        return Response(ArticleListSerializer(queryset, many=True).data)

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
        summary="List questions",
        responses={200: QuestionListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        questions = Question.objects.select_related("author").prefetch_related("tags", "answers")
        return Response(QuestionListSerializer(questions, many=True).data)

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
        question = get_object_or_404(
            Question.objects.select_related("author").prefetch_related("tags", "answers__author"), pk=pk
        )
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
        return Response(AnswerSerializer(question.answers.select_related("author"), many=True).data)

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
