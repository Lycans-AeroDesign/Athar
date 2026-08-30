from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class DefaultPagination(PageNumberPagination):
    """Shared by every plain-APIView list endpoint via paginated_response()
    below, plus any ListAPIView that sets pagination_class = DefaultPagination
    directly (e.g. audit.views.AuditLogListView). page_size_query_param lets
    a caller that genuinely needs "everything" (e.g. a settings screen
    editing the full list locally) ask for up to max_page_size in one page
    instead of paging through - see CONTRIBUTING.md notes on RolesSettingsForm."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


def paginated_response(request, queryset, serializer_class, context=None) -> Response:
    """One-liner for the plain-APIView list endpoints (ArticleListCreateView.get
    and friends) - these aren't ListAPIView subclasses, so DRF's pagination
    machinery has to be driven by hand rather than picked up automatically."""
    paginator = DefaultPagination()
    page = paginator.paginate_queryset(queryset, request)
    serializer = serializer_class(page, many=True, context=context or {})
    return paginator.get_paginated_response(serializer.data)
