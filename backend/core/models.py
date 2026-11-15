import uuid

from django.conf import settings
from django.db import models


class UUIDPrimaryKeyModel(models.Model):
    """Shared UUID pk base - see CONTRIBUTING.md §3.4. uuid7, not uuid4: its
    leading 48 bits are a millisecond timestamp, so new keys land at the end
    of the primary-key B-tree instead of at random positions (fewer page
    splits, better cache locality as tables grow) and sort by creation time.
    Rows created before the switch keep their uuid4 ids - nothing depends on
    the version. Python 3.14's stdlib provides uuid.uuid7()."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    """Shared created_at/updated_at pair - see CONTRIBUTING.md §3.4."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OrganizationScopedModel(models.Model):
    """Every tenant-owned model gets this - the multi-tenancy retrofit's
    single scoping primitive. Deliberately NOT used by models that are only
    ever reached through an already-scoped parent (ArticleRevision, Answer,
    every XAttachment model) - adding a redundant organization FK there would
    be sync-risk-prone duplication, not a real second scoping boundary; see
    each such model's own docstring for why it's excluded on purpose."""

    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE)

    class Meta:
        abstract = True


class ActiveManager(models.Manager):
    """Default manager of a SoftDeleteModel: hides rows that are in the trash."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    """Deleting moves a row to the trash (knowledge/trash.py) instead of
    removing it; it's purged for real after TRASH_RETENTION_DAYS.

    `objects` hides trashed rows, so every list, search and lookup that goes
    through it skips them without changes. `all_objects` sees everything -
    use it for the trash itself, backups, and uniqueness checks (a trashed
    article still owns its slug). Django's base manager (used to follow
    foreign keys and generic relations) stays unfiltered, so a relation or
    collection pointing at a trashed row still resolves; those read paths
    hide it through visibility.can_view_instance instead, which keeps the
    link intact for when the row is restored."""

    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    objects = ActiveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    @property
    def is_trashed(self) -> bool:
        return self.deleted_at is not None
