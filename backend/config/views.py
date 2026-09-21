from django.http import JsonResponse

# Django's own handler404/handler500 (below, only reached outside DEBUG -
# Django itself skips them for the technical debug pages while DEBUG=True,
# see django.core.handlers.exception.response_for_exception) - this is
# strictly an API server with no HTML pages of its own (the frontend is a
# separate app), so *every* response it ever sends back should be JSON, not
# Django's default plain-HTML 404/500 templates. A direct browser hit on a
# stale/mistyped/auth-gated URL should look like an API error, never like it
# came from a Django app underneath.


def api_not_found(request, exception=None):
    return JsonResponse({"detail": "Not found."}, status=404)


def api_server_error(request):
    return JsonResponse({"detail": "An unexpected error occurred."}, status=500)
