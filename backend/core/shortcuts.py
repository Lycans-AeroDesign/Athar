import uuid

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError


def org_object_or_404(request, model_or_queryset, pk):
    """get_object_or_404 scoped to the requesting user's organization."""
    return get_object_or_404(model_or_queryset, pk=pk, organization=request.user.organization)


def uuid_query_param(request, name: str):
    """A ?name=<uuid> filter value (None when absent), or a 400 - a malformed id
    would otherwise 500 on the UUID column lookup."""
    raw = request.query_params.get(name, "").strip()
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise ValidationError({name: ["Must be a valid id."]}) from None
