from django.conf import settings
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
    path("api/v1/", include(v1_patterns)),
]

# Dev/staging only - not registered at all outside DEBUG:
# - Django admin: the org's own Settings UI (roles, categories, branding, ...)
#   is the real admin surface in production; /admin/ here is a dev/debugging
#   tool, and its login page has no rate limiting of its own (see
#   accounts/views.py's "auth" throttle scope, which doesn't cover it).
# - The OpenAPI schema documents every endpoint's shape and permission
#   requirements, and drf-spectacular's views default to AllowAny regardless
#   of DRF's global permission - so without this they'd be world-readable in
#   production too.
if settings.DEBUG:
    urlpatterns += [
        path("admin/", admin.site.urls),
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    ]
