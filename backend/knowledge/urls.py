from django.urls import path

from .views import (
    AnswerDetailView,
    AnswerListCreateView,
    ArticleDetailView,
    ArticleListCreateView,
    ArticlePublishView,
    ArticleSubmitView,
    CategoryListView,
    QuestionAcceptAnswerView,
    QuestionDetailView,
    QuestionListCreateView,
    TagListView,
)

urlpatterns = [
    path("categories/", CategoryListView.as_view(), name="knowledge-category-list"),
    path("tags/", TagListView.as_view(), name="knowledge-tag-list"),
    path("articles/", ArticleListCreateView.as_view(), name="knowledge-article-list-create"),
    path("articles/<uuid:pk>/", ArticleDetailView.as_view(), name="knowledge-article-detail"),
    path("articles/<uuid:pk>/submit/", ArticleSubmitView.as_view(), name="knowledge-article-submit"),
    path("articles/<uuid:pk>/publish/", ArticlePublishView.as_view(), name="knowledge-article-publish"),
    path("questions/", QuestionListCreateView.as_view(), name="knowledge-question-list-create"),
    path("questions/<uuid:pk>/", QuestionDetailView.as_view(), name="knowledge-question-detail"),
    path("questions/<uuid:pk>/answers/", AnswerListCreateView.as_view(), name="knowledge-answer-list-create"),
    path("questions/<uuid:pk>/accept/", QuestionAcceptAnswerView.as_view(), name="knowledge-question-accept"),
    path("answers/<uuid:pk>/", AnswerDetailView.as_view(), name="knowledge-answer-detail"),
]
