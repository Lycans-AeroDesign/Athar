from django.urls import path

from .views import (
    PermissionListView,
    RoleDetailView,
    RoleListCreateView,
    RolePermissionDetailView,
    RolePermissionsView,
    UserListView,
    UserRoleDetailView,
    UserRolesView,
)

urlpatterns = [
    path("roles/", RoleListCreateView.as_view(), name="rbac-roles"),
    path("roles/<uuid:pk>/", RoleDetailView.as_view(), name="rbac-role-detail"),
    path("roles/<uuid:pk>/permissions/", RolePermissionsView.as_view(), name="rbac-role-permissions"),
    path(
        "roles/<uuid:pk>/permissions/<uuid:permission_id>/",
        RolePermissionDetailView.as_view(),
        name="rbac-role-permission-detail",
    ),
    path("permissions/", PermissionListView.as_view(), name="rbac-permissions"),
    path("users/", UserListView.as_view(), name="rbac-users"),
    path("users/<uuid:pk>/roles/", UserRolesView.as_view(), name="rbac-user-roles"),
    path(
        "users/<uuid:pk>/roles/<uuid:role_id>/",
        UserRoleDetailView.as_view(),
        name="rbac-user-role-detail",
    ),
]
