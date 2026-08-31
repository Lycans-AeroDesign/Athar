from django.urls import path

from .views import (
    InvitationCodeListCreateView,
    InvitationCodeRevokeView,
    LoginView,
    LogoutView,
    MeView,
    RefreshView,
    RegisterView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("invitations/", InvitationCodeListCreateView.as_view(), name="auth-invitation-list-create"),
    path("invitations/<uuid:pk>/revoke/", InvitationCodeRevokeView.as_view(), name="auth-invitation-revoke"),
]
