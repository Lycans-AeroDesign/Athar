from rest_framework.permissions import BasePermission


class HasPermission(BasePermission):
    """Generic DRF permission: checks request.user.has_permission(codename).

    Never compare role names directly in a view - permission_codename is the
    only thing views should depend on, so what a role grants stays fully
    admin-configurable.
    """

    permission_codename: str | None = None

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.has_permission(self.permission_codename)
        )


def require_permission(codename: str) -> type[HasPermission]:
    return type(f"HasPermission_{codename}", (HasPermission,), {"permission_codename": codename})
