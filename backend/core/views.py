from django.db import connection
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckView(APIView):
    """Liveness/readiness probe for external monitors and nginx's own
    /api/v1/health/ location (see nginx/nginx.conf) - deliberately AllowAny
    and outside the "auth" throttle scope (see accounts/views.py) so
    monitoring traffic never counts against real users' rate limits; nginx
    applies its own separate, stricter limit to this path instead."""

    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Health"],
        summary="Liveness/readiness check - verifies the database is reachable",
        responses={
            200: OpenApiResponse(description="Healthy."),
            503: OpenApiResponse(description="Database unreachable."),
        },
    )
    def get(self, request):
        try:
            connection.ensure_connection()
        except Exception:
            return Response({"status": "unhealthy"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"status": "ok"})
