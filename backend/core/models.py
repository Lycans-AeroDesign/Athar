import uuid

from django.db import models


class UUIDPrimaryKeyModel(models.Model):
    """Shared UUID pk base - see CONTRIBUTING.md §3.4, which reserves this
    app/pattern for exactly this ("*Policy for once a shared `backend/core`
    app exists*"). Uses uuid4, matching every model that already hand-rolled
    this field before this app existed; CONTRIBUTING §3.4 anticipates a
    future uuid7 variant, which is an unrelated, separate improvement (sort-
    ordering pk churn, not multi-tenancy) - not bundled into this pass."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

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
