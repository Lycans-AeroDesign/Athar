from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework_simplejwt.authentication import JWTAuthentication

from .services import has_pending_policies

POLICY_ACCEPTANCE_REQUIRED = "policy_acceptance_required"

# URL names a user may still call while they have unaccepted policies: read
# and accept the policies themselves, load their own session (the frontend
# needs /auth/me to render the gate), and log out (the gate's "decline").
# The admin policy endpoints stay reachable too (they still require
# organization.manage) - publishing one policy gates the publisher as well,
# and they mustn't be locked out of publishing the next one or fixing a typo.
# Everything else is refused server-side - the frontend PolicyGate is only
# the UX for this, not the enforcement (see CONTRIBUTING.md §6).
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
    current policy version they haven't accepted. Installed as the default
    authentication class, so it covers every view that doesn't opt out of
    authentication entirely."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, _token = result
        resolver_match = getattr(request._request, "resolver_match", None)
        url_name = resolver_match.url_name if resolver_match else None
        if url_name in ALLOWED_WHILE_PENDING or _is_public_view(request):
            return result
        if has_pending_policies(user):
            raise PermissionDenied(
                {"detail": "You need to accept the updated policies to continue.", "code": POLICY_ACCEPTANCE_REQUIRED}
            )
        return result
