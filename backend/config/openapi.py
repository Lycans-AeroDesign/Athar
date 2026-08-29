"""Shared OpenAPI response shapes, reused across every app's @extend_schema calls.

No shared `core` app exists yet (see CONTRIBUTING.md §3.4) - this plain module
is the "one place" for common error response docs called for in §3.1 until
one does.
"""

from drf_spectacular.utils import OpenApiResponse

UNAUTHORIZED = OpenApiResponse(description="Authentication credentials were missing or invalid.")
FORBIDDEN = OpenApiResponse(description="Authenticated, but lacks the required permission.")
NOT_FOUND = OpenApiResponse(description="The requested object does not exist.")
BAD_REQUEST = OpenApiResponse(description="The request body failed validation.")

COMMON_ERRORS = {401: UNAUTHORIZED, 403: FORBIDDEN}
