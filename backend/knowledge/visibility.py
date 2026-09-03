"""Single shared implementation of the RESTRICTED-visibility rule (see
Visibility's docstring in models.py) - replaces what used to be three
near-identical copies (views._visible_article_or_404/_visible_question_or_404/
_visible_document_or_404 and services.visible_articles_for/
visible_questions_for/visible_documents_for/_relatable_visible_to), and now
also covers the engineering-domain types (Project/Component/Failure/Sop/Test)
now that they carry a `visibility` field too.

Imported by both services.py and views.py - kept as its own module (rather
than folded into services.py) specifically so it has no dependency on
services.py's own private helpers (_resolve_relatable, _RELATABLE_MODELS),
avoiding a circular import.
"""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q, QuerySet

from .models import RestrictedAccessGrant, Visibility

# Holding this permission means "see everything in this org, RESTRICTED
# included" - confirmed unique to the seeded Organization Admin role (the
# only role granted the full PERMISSION_CATALOGUE, see rbac/catalogue.py),
# so this is a real "is this an org admin" signal, not a guess.
ADMIN_BYPASS_PERMISSION = "organization.manage"

# model_name -> the field identifying who owns/created the instance, for the
# "owner can always see their own RESTRICTED item" rule.
OWNER_FIELD = {
    "article": "author",
    "question": "author",
    "document": "created_by",
    "project": "created_by",
    "component": "created_by",
    "failure": "created_by",
    "sop": "created_by",
    "test": "created_by",
}

# model_name -> permission codename(s) that let a non-owner see a RESTRICTED
# instance of that type regardless of any grant - the pre-existing
# moderation/publishing permissions each type already had before this rule
# was consolidated (Article: reviewer/publisher; Question: moderator;
# everything else: its own `<type>.update` holder).
OVERRIDE_PERMISSIONS = {
    "article": ("article.review", "article.publish"),
    "question": ("question.moderate",),
    "document": ("document.update",),
    "project": ("project.update",),
    "component": ("component.update",),
    "failure": ("failure.update",),
    "sop": ("sop.update",),
    "test": ("test.update",),
}


def is_org_admin(viewer) -> bool:
    return viewer.has_permission(ADMIN_BYPASS_PERMISSION)


def _has_override(viewer, model_name: str) -> bool:
    return any(viewer.has_permission(codename) for codename in OVERRIDE_PERMISSIONS.get(model_name, ()))


def is_privileged_for(viewer, model_name: str, instance) -> bool:
    """Owner/creator, org admin, or an override-permission holder -
    independent of whether `instance` is actually RESTRICTED. Article's own
    draft/in-review status gate is a separate axis handled by its caller;
    this only ever covers the RESTRICTED rule."""
    if is_org_admin(viewer):
        return True
    owner_field = OWNER_FIELD.get(model_name)
    if owner_field and getattr(instance, owner_field, None) == viewer:
        return True
    return _has_override(viewer, model_name)


def can_view_instance(viewer, model_name: str, instance) -> bool:
    """Instance-level check: non-RESTRICTED content is always visible;
    RESTRICTED content requires is_privileged_for(...) or an explicit
    RestrictedAccessGrant naming `viewer`."""
    if instance is None:
        return False
    if getattr(instance, "visibility", None) != Visibility.RESTRICTED:
        return True
    if is_privileged_for(viewer, model_name, instance):
        return True
    return RestrictedAccessGrant.objects.filter(
        content_type=ContentType.objects.get_for_model(type(instance)),
        object_id=instance.pk,
        granted_user=viewer,
    ).exists()


def exclude_inaccessible(queryset: QuerySet, viewer, model, model_name: str) -> QuerySet:
    """Queryset-level counterpart of can_view_instance, for list/search
    endpoints - drops RESTRICTED rows `viewer` can't see via ownership, the
    org-admin bypass, an override permission, or an explicit grant."""
    if is_org_admin(viewer) or _has_override(viewer, model_name):
        return queryset
    owner_field = OWNER_FIELD.get(model_name)
    owned = Q(**{owner_field: viewer}) if owner_field else Q(pk__in=[])
    granted_ids = RestrictedAccessGrant.objects.filter(
        content_type=ContentType.objects.get_for_model(model),
        granted_user=viewer,
    ).values_list("object_id", flat=True)
    return queryset.exclude(Q(visibility=Visibility.RESTRICTED) & ~owned & ~Q(pk__in=granted_ids))
