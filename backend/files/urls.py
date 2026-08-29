from django.urls import path

from .views import FileDeleteView, FileDownloadView, FileUploadView

urlpatterns = [
    path("upload/", FileUploadView.as_view(), name="files-upload"),
    path("<uuid:pk>/download/", FileDownloadView.as_view(), name="files-download"),
    path("<uuid:pk>/delete/", FileDeleteView.as_view(), name="files-delete"),
]
