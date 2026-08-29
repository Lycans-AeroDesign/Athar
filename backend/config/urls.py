from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

v1_patterns = [
    path("auth/", include("accounts.urls")),
    path("rbac/", include("rbac.urls")),
    path("audit/", include("audit.urls")),
    path("files/", include("files.urls")),
    path("organization/", include("organization.urls")),
    path("knowledge/", include("knowledge.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(v1_patterns)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]
