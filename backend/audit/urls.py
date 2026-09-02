from django.urls import path

from .views import AuditLogListView, KnowledgeActivityView, UserActivityView

urlpatterns = [
    path("logs/", AuditLogListView.as_view(), name="audit-logs"),
    path("activity/", KnowledgeActivityView.as_view(), name="audit-knowledge-activity"),
    path("users/<uuid:pk>/activity/", UserActivityView.as_view(), name="audit-user-activity"),
]
