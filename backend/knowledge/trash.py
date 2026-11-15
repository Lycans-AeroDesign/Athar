"""The trash: deleted content waits here for TRASH_RETENTION_DAYS before it's
purged for real, and can be restored until then.

Covers every SoftDeleteModel in registry(). Who may do what:
- move to trash: whatever the type's own delete_* service already allows
  (it checks, then calls move_to_trash);
- see and restore a trashed item: whoever trashed it, or a holder of the
  type's delete/moderate permission;
- delete forever before the retention period ends: trash.purge.
"""

import datetime
import functools
from dataclasses import dataclass

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.services import log_action

from .models import (
    Article,
    Bookmark,
    CollectionItem,
    Component,
    Document,
    Failure,
    KnowledgeRelation,
    Project,
    Question,
    RestrictedAccessGrant,
    Sop,
    Test,
)

PURGE_PERMISSION = "trash.purge"


@dataclass(frozen=True)
class TrashType:
    model: type
    # Holders see and restore everyone's trashed items of this type, not
    # only their own.
    manage_permission: str
    title_field: str = "title"


@functools.cache
def registry() -> dict[str, TrashType]:
    """Built on first use: training imports knowledge, so Course can't be
    imported at this module's load time."""
    from training.models import Course

    return {
        "article": TrashType(Article, "article.delete"),
        "question": TrashType(Question, "question.moderate"),
        "project": TrashType(Project, "project.delete", "name"),
        "component": TrashType(Component, "component.delete", "name"),
        "failure": TrashType(Failure, "failure.delete"),
        "sop": TrashType(Sop, "sop.delete"),
        "test": TrashType(Test, "test.delete"),
        "document": TrashType(Document, "document.update"),
        "course": TrashType(Course, "training.delete"),
    }


def title_of(model_name: str, instance) -> str:
    return getattr(instance, registry()[model_name].title_field)


def retention() -> datetime.timedelta:
    return datetime.timedelta(days=settings.TRASH_RETENTION_DAYS)


def purge_at(instance) -> datetime.datetime:
    return instance.deleted_at + retention()


def get_type(model_name: str) -> TrashType:
    trash_type = registry().get(model_name)
    if trash_type is None:
        raise PermissionDenied("That kind of item can't be in the trash.")
    return trash_type


def move_to_trash(*, model_name: str, instance, actor, request=None) -> None:
    """Callers check their own delete permission first."""
    instance.deleted_at = timezone.now()
    instance.deleted_by = actor
    # update_fields without updated_at: trashing isn't an edit, and
    # updated_at drives "recently updated" ordering once it's restored.
    type(instance)._base_manager.filter(pk=instance.pk).update(deleted_at=instance.deleted_at, deleted_by=actor)
    log_action(actor=actor, action=f"{model_name}.trash", target=instance, request=request)


def can_manage(actor, model_name: str, instance) -> bool:
    return instance.deleted_by_id == actor.id or actor.has_permission(get_type(model_name).manage_permission)


def trashed_items_for(actor, model_name: str | None = None) -> list[tuple[str, object]]:
    """(model name, instance) for every trashed item `actor` may see, newest
    deletion first."""
    items = []
    for name, trash_type in registry().items():
        if model_name and name != model_name:
            continue
        queryset = trash_type.model.all_objects.filter(
            organization=actor.organization, deleted_at__isnull=False
        ).select_related("deleted_by")
        if not actor.has_permission(trash_type.manage_permission):
            queryset = queryset.filter(deleted_by=actor)
        items.extend((name, instance) for instance in queryset)
    items.sort(key=lambda item: item[1].deleted_at, reverse=True)
    return items


def get_trashed(actor, model_name: str, pk):
    """The trashed item, or None if it doesn't exist, isn't trashed, belongs
    to another organization, or `actor` may not see it - all the same answer,
    so ids of other people's deleted content aren't confirmed."""
    trash_type = get_type(model_name)
    instance = (
        trash_type.model.all_objects.filter(organization=actor.organization, deleted_at__isnull=False, pk=pk)
        .select_related("deleted_by")
        .first()
    )
    if instance is None or not can_manage(actor, model_name, instance):
        return None
    return instance


def restore(*, model_name: str, instance, actor, request=None):
    type(instance)._base_manager.filter(pk=instance.pk).update(deleted_at=None, deleted_by=None)
    instance.deleted_at = None
    instance.deleted_by = None
    log_action(actor=actor, action=f"{model_name}.restore", target=instance, request=request)
    return instance


def purge(*, model_name: str, instance, actor=None, request=None) -> None:
    """Deletes for real. `actor` None = the scheduled retention purge."""
    if actor is not None and not actor.has_permission(PURGE_PERMISSION):
        raise PermissionDenied("Deleting from the trash permanently requires trash.purge.")
    log_action(
        actor=actor,
        action=f"{model_name}.purge",
        metadata={f"{model_name}_id": str(instance.pk), "title": title_of(model_name, instance)},
        request=request,
        organization=instance.organization,
    )
    with transaction.atomic():
        _delete_generic_references(instance)
        instance.delete()


def _delete_generic_references(instance) -> None:
    """Generic foreign keys don't cascade - without this, collections,
    relations, bookmarks and access grants would keep pointing at a row
    that no longer exists."""
    content_type = ContentType.objects.get_for_model(type(instance))
    CollectionItem.objects.filter(content_type=content_type, object_id=instance.pk).delete()
    Bookmark.objects.filter(content_type=content_type, object_id=instance.pk).delete()
    RestrictedAccessGrant.objects.filter(content_type=content_type, object_id=instance.pk).delete()
    KnowledgeRelation.objects.filter(
        Q(source_content_type=content_type, source_object_id=instance.pk)
        | Q(target_content_type=content_type, target_object_id=instance.pk)
    ).delete()


def purge_expired() -> int:
    """Purges everything trashed longer than the retention period. Run
    daily by Celery beat (knowledge.tasks.purge_expired_trash)."""
    cutoff = timezone.now() - retention()
    count = 0
    for model_name, trash_type in registry().items():
        for instance in trash_type.model.all_objects.filter(deleted_at__lt=cutoff).select_related("organization"):
            purge(model_name=model_name, instance=instance)
            count += 1
    return count
