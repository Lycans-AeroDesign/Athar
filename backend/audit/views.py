from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListAPIView

from config.openapi import COMMON_ERRORS
from rbac.permissions import require_permission

from .models import AuditLog
from .serializers import AuditLogSerializer


@extend_schema(tags=["Audit"], summary="List audit log entries", responses={200: AuditLogSerializer(many=True), **COMMON_ERRORS})
class AuditLogListView(ListAPIView):
    permission_classes = [require_permission("audit.read")]
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor").all()
