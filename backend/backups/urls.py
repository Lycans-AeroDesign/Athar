from django.urls import path

from .views import (
    BackupJobDetailView,
    BackupJobDownloadView,
    BackupJobListCreateView,
    RestoreJobDetailView,
    RestoreJobListCreateView,
    RestoreJobUploadView,
)

urlpatterns = [
    path("", BackupJobListCreateView.as_view(), name="backups-list-create"),
    path("<uuid:pk>/", BackupJobDetailView.as_view(), name="backups-detail"),
    path("<uuid:pk>/download/", BackupJobDownloadView.as_view(), name="backups-download"),
    path("restores/", RestoreJobListCreateView.as_view(), name="backups-restore-list-create"),
    path("restores/upload/", RestoreJobUploadView.as_view(), name="backups-restore-upload"),
    path("restores/<uuid:pk>/", RestoreJobDetailView.as_view(), name="backups-restore-detail"),
]
