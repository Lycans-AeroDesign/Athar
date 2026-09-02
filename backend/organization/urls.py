from django.urls import path

from .views import (
    OrganizationBrandingUpdateView,
    OrganizationCreateView,
    OrganizationFaviconView,
    OrganizationGeneralUpdateView,
    OrganizationLogoView,
    OrganizationSettingsView,
)

urlpatterns = [
    path("", OrganizationCreateView.as_view(), name="organization-create"),
    path("settings/", OrganizationSettingsView.as_view(), name="organization-settings"),
    path("settings/logo/", OrganizationLogoView.as_view(), name="organization-logo"),
    path("settings/favicon/", OrganizationFaviconView.as_view(), name="organization-favicon"),
    path("settings/general/", OrganizationGeneralUpdateView.as_view(), name="organization-general-update"),
    path(
        "settings/branding/",
        OrganizationBrandingUpdateView.as_view(),
        name="organization-branding-update",
    ),
]
