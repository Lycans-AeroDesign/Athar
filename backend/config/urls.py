from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

v1_patterns = [
    path("health/", include("core.urls")),
    path("auth/", include("accounts.urls")),
    path("rbac/", include("rbac.urls")),
    path("audit/", include("audit.urls")),
    path("files/", include("files.urls")),
    path("organization/", include("organization.urls")),
    path("knowledge/", include("knowledge.urls")),
    path("training/", include("training.urls")),
    path("backups/", include("backups.urls")),
    path("policies/", include("policies.urls")),
    path("platform/", include("platform_admin.urls")),
]

urlpatterns = [
    path("api/v1/", include(v1_patterns)),
]

# Dev/staging only, not registered outside DEBUG:
# - Django admin: production uses the org's Settings UI; /admin/ is a debugging tool whose
#   login has no rate limiting.
# - The OpenAPI schema: drf-spectacular's views default to AllowAny, so they'd be
#   world-readable in production.
if settings.DEBUG:
    urlpatterns += [
        path("admin/", admin.site.urls),
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    ]

# Only reached when DEBUG=False (see config/views.py) - keeps every response
# this API server ever sends JSON, even for a URL that matched no view at all
# or an exception no view/DRF exception handler caught.
handler404 = "config.views.api_not_found"
handler500 = "config.views.api_server_error"
