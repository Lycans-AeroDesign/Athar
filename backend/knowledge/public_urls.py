"""No-login routes, mounted at /api/v1/public/ - only share links so far
(knowledge/sharing.py). Everything here is AllowAny, so keep it minimal."""

from django.urls import path

from .views import PublicShareFileView, PublicShareView

urlpatterns = [
    path("shares/<str:token>/", PublicShareView.as_view(), name="public-share"),
    path("shares/<str:token>/files/<uuid:file_id>/", PublicShareFileView.as_view(), name="public-share-file"),
]
