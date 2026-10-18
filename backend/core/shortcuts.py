from django.shortcuts import get_object_or_404


def org_object_or_404(request, model_or_queryset, pk):
    """get_object_or_404 scoped to the requesting user's organization."""
    return get_object_or_404(model_or_queryset, pk=pk, organization=request.user.organization)
