from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class PolicyEnforcingJWTScheme(SimpleJWTScheme):
    """Same Bearer-JWT OpenAPI scheme as plain JWTAuthentication - the policy
    gate doesn't change how requests authenticate. Registered on import (see
    PoliciesConfig.ready)."""

    target_class = "policies.authentication.PolicyEnforcingJWTAuthentication"
