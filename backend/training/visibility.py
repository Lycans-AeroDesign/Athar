"""RESTRICTED-visibility rule for courses - the training counterpart of
knowledge/visibility.py, reusing its Visibility choices, its org-admin
bypass and its RestrictedAccessGrant model (generic content_type/object_id,
so a grant can name a Course as easily as an Article). Kept as its own
module rather than folded into knowledge/visibility.py so Training's
override permissions stay defined next to the rest of Training.

Orthogonal to course *status*: views._ensure_course_visible applies this
first, then its own draft/published/archived rules on top."""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q, QuerySet

from knowledge.models import RestrictedAccessGrant, Visibility
from knowledge.visibility import is_org_admin

from .models import Course

# Holders see every RESTRICTED course in their org, same as the people who
# can already see every course draft (see views._ensure_course_visible) -
# the ones who manage, review and publish courses.
OVERRIDE_PERMISSIONS = ("training.update", "training.review", "training.publish", "training.manage")


def _has_override(viewer) -> bool:
    return is_org_admin(viewer) or any(viewer.has_permission(codename) for codename in OVERRIDE_PERMISSIONS)


def can_view_course(viewer, course: Course) -> bool:
    if course.visibility != Visibility.RESTRICTED:
        return True
    if course.author_id == viewer.id or _has_override(viewer):
        return True
    return RestrictedAccessGrant.objects.filter(
        content_type=ContentType.objects.get_for_model(Course), object_id=course.pk, granted_user=viewer
    ).exists()


def exclude_inaccessible_courses(queryset: QuerySet, viewer, course_field: str = "") -> QuerySet:
    """Queryset counterpart of can_view_course. `course_field` is the path to
    the Course from the queryset's model ("" for a Course queryset itself,
    "course" for CourseEnrollment, ...)."""
    if _has_override(viewer):
        return queryset
    prefix = f"{course_field}__" if course_field else ""
    granted_ids = RestrictedAccessGrant.objects.filter(
        content_type=ContentType.objects.get_for_model(Course), granted_user=viewer
    ).values_list("object_id", flat=True)
    return queryset.exclude(
        Q(**{f"{prefix}visibility": Visibility.RESTRICTED})
        & ~Q(**{f"{prefix}author": viewer})
        & ~Q(**{f"{prefix}id__in": granted_ids})
    )
