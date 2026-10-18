from django.http import JsonResponse

# Django's handler404/handler500 (reached only outside DEBUG). This is a pure API server,
# so every response should be JSON rather than Django's default HTML error pages.


def api_not_found(request, exception=None):
    return JsonResponse({"detail": "Not found."}, status=404)


def api_server_error(request):
    return JsonResponse({"detail": "An unexpected error occurred."}, status=500)
