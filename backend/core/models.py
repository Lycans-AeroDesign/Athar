import uuid

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
