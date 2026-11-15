from django.urls import path

from .views import (
    ErrorDetailView,
    ErrorListView,
    ErrorReportView,
    ErrorResolvedView,
    OrganizationActiveView,
    OrganizationDetailView,
    OrganizationListView,
    OrganizationUsersView,
    SettingsView,
    SummaryView,
    UserActiveView,
    UserPasswordResetLinkView,
)

urlpatterns = [
    path("errors/", ErrorListView.as_view(), name="platform-error-list"),
    path("errors/report/", ErrorReportView.as_view(), name="platform-error-report"),
    path("errors/<uuid:pk>/", ErrorDetailView.as_view(), name="platform-error-detail"),
    path("errors/<uuid:pk>/resolved/", ErrorResolvedView.as_view(), name="platform-error-resolved"),
    path("settings/", SettingsView.as_view(), name="platform-settings"),
    path("summary/", SummaryView.as_view(), name="platform-summary"),
    path("organizations/", OrganizationListView.as_view(), name="platform-organization-list"),
    path("organizations/<uuid:pk>/", OrganizationDetailView.as_view(), name="platform-organization-detail"),
    path("organizations/<uuid:pk>/users/", OrganizationUsersView.as_view(), name="platform-organization-users"),
    path("organizations/<uuid:pk>/active/", OrganizationActiveView.as_view(), name="platform-organization-active"),
    path("users/<uuid:pk>/active/", UserActiveView.as_view(), name="platform-user-active"),
    path(
        "users/<uuid:pk>/password-reset-link/",
        UserPasswordResetLinkView.as_view(),
        name="platform-user-password-reset-link",
    ),
]
