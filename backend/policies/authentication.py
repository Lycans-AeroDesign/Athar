from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication

from billing.services import is_read_only
from organization.models import Organization

from .services import has_pending_policies

POLICY_ACCEPTANCE_REQUIRED = "policy_acceptance_required"
ORGANIZATION_SUSPENDED = "organization_suspended"
SUBSCRIPTION_EXPIRED = "subscription_expired"

# Writes still allowed while the org's subscription has expired (read-only mode): sign out,
# accept policies, take a backup to export their data, and delete one's own account.
ALLOWED_WHILE_READ_ONLY = {
    "auth-logout",
    "policies-accept",
    "backups-list-create",
    "auth-me-delete",
    "platform-error-report",
}

# URL names callable while policies are unaccepted: read/accept the policies, load own
# session (/auth/me, for the gate UI), and log out (the gate's "decline"). Admin policy
# endpoints stay reachable (still require organization.manage) so a publisher isn't locked
# out of publishing the next policy. Everything else is refused server-side; the frontend
# PolicyGate is only UX (see CONTRIBUTING.md 6).
ALLOWED_WHILE_PENDING = {
    "policies-current",
    "policies-accept",
    "policies-manage",
    "policies-draft",
    "policies-publish",
    "auth-me",
    "auth-logout",
}


def _is_public_view(request) -> bool:
    """Endpoints anyone may call without logging in (org branding, logo,
    favicon, ...) stay reachable - the browser still sends a gated user's
    token to them, and refusing something that's public anyway protects
    nothing while breaking the gate screen's own branding."""
    view = (request.parser_context or {}).get("view")
    if view is None:
        return False
    permissions = view.get_permissions()
    return bool(permissions) and all(isinstance(permission, AllowAny) for permission in permissions)


class PolicyEnforcingJWTAuthentication(JWTAuthentication):
    """JWTAuthentication that additionally refuses every authenticated API
    request (403, code "policy_acceptance_required") while the user has a
    current policy version they haven't accepted, and every write (403, code
    "subscription_expired") while their org's subscription has expired
    (billing.services.is_read_only). Installed as the default authentication
    class, so it covers every view that doesn't opt out of authentication
    entirely."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, _token = result
        if not user.is_superuser:
            # Same one query as loading user.organization, with the subscription joined in.
            user.organization = Organization.objects.select_related("subscription").get(pk=user.organization_id)
            if not user.organization.is_active:
                raise PermissionDenied(
                    {"detail": "This organization has been suspended.", "code": ORGANIZATION_SUSPENDED}
                )
        if _is_public_view(request):
            return result
        resolver_match = getattr(request._request, "resolver_match", None)
        url_name = resolver_match.url_name if resolver_match else None
        if (
            not user.is_superuser
            and request.method not in SAFE_METHODS
            and url_name not in ALLOWED_WHILE_READ_ONLY
            and is_read_only(user.organization)
        ):
            raise PermissionDenied(
                {
                    "detail": "This organization's subscription has expired, so it's read-only until it's renewed.",
                    "code": SUBSCRIPTION_EXPIRED,
                }
            )
        if url_name in ALLOWED_WHILE_PENDING:
            return result
        if has_pending_policies(user):
            raise PermissionDenied(
                {"detail": "You need to accept the updated policies to continue.", "code": POLICY_ACCEPTANCE_REQUIRED}
            )
        return result
