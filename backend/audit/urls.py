from django.urls import path

from .views import AuditLogListView, KnowledgeActivityView

urlpatterns = [
    path("logs/", AuditLogListView.as_view(), name="audit-logs"),
    path("activity/", KnowledgeActivityView.as_view(), name="audit-knowledge-activity"),
]
