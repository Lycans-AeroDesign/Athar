from rest_framework.permissions import BasePermission


class IsPlatformAdmin(BasePermission):
    """Instance operators only (User.is_superuser). Deliberately not an RBAC permission: those
    are per-organization and every org admin holds the full catalogue."""

    message = "Platform administrator access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)
