from django.urls import path

from .views import (
    InvitationCodeListCreateView,
    InvitationCodeRevokeView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetCheckView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RefreshView,
    RegisterView,
    UserPasswordResetLinkView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("invitations/", InvitationCodeListCreateView.as_view(), name="auth-invitation-list-create"),
    path("invitations/<uuid:pk>/revoke/", InvitationCodeRevokeView.as_view(), name="auth-invitation-revoke"),
    path(
        "users/<uuid:pk>/password-reset-link/",
        UserPasswordResetLinkView.as_view(),
        name="auth-user-password-reset-link",
    ),
    path("password-reset/request/", PasswordResetRequestView.as_view(), name="auth-password-reset-request"),
    path("password-reset/check/", PasswordResetCheckView.as_view(), name="auth-password-reset-check"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
]
