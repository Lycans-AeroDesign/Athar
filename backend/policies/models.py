from django.conf import settings
from django.db import models

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel


class PolicyKind(models.TextChoices):
    PRIVACY = "PRIVACY", "Privacy policy"
    CONFIDENTIALITY = "CONFIDENTIALITY", "Confidentiality agreement"


class PolicyDraft(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """The admin's working copy of one policy - edited freely, invisible to
    members until published (see services.publish_policy), which snapshots
    it into a new PolicyVersion. One draft per (organization, kind)."""

    kind = models.CharField(max_length=20, choices=PolicyKind.choices)
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "kind"], name="unique_policy_draft_per_kind")]


class PolicyVersion(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """An immutable published snapshot. Exactly one version per (organization,
    kind) is `is_current`; every member must have a PolicyAcceptance for
    every current version before the API lets them do anything else (see
    policies.authentication). Old versions are kept as the record of what
    each member actually agreed to."""

    kind = models.CharField(max_length=20, choices=PolicyKind.choices)
    version = models.PositiveIntegerField()
    title = models.CharField(max_length=200)
    content = models.TextField()
    is_current = models.BooleanField(default=False)
    published_at = models.DateTimeField()
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["kind", "-version"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "kind", "version"], name="unique_policy_version"),
            models.UniqueConstraint(
                fields=["organization", "kind"],
                condition=models.Q(is_current=True),
                name="one_current_policy_version_per_kind",
            ),
        ]


class PolicyAcceptance(UUIDPrimaryKeyModel, TimeStampedModel):
    """Reached through its (already org-scoped) PolicyVersion, so no
    organization FK of its own - same reasoning as Answer/ArticleRevision."""

    version = models.ForeignKey(PolicyVersion, on_delete=models.CASCADE, related_name="acceptances")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="policy_acceptances")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["version", "user"], name="unique_policy_acceptance")]
