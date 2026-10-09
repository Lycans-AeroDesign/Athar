from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from audit.services import log_action

from .defaults import DEFAULT_POLICIES
from .models import PolicyAcceptance, PolicyDraft, PolicyKind, PolicyVersion


def current_versions_for(organization):
    return PolicyVersion.objects.filter(organization=organization, is_current=True)


def pending_versions_for(user):
    """Current policy versions `user` hasn't accepted yet - what the policy
    gate (policies.authentication and the frontend PolicyGate) blocks on."""
    return current_versions_for(user.organization).exclude(acceptances__user=user)


def has_pending_policies(user) -> bool:
    return pending_versions_for(user).exists()


def seed_default_policies(organization, *, published_by=None) -> None:
    """Publishes the starter policies (policies/defaults.py) as version 1 for
    a new organization - same as migrations/0002 did for every organization
    that existed then. Skips any kind the organization already has."""
    now = timezone.now()
    for kind, title, content in DEFAULT_POLICIES:
        if PolicyVersion.objects.filter(organization=organization, kind=kind).exists():
            continue
        PolicyDraft.objects.update_or_create(
            organization=organization, kind=kind, defaults={"title": title, "content": content, "updated_by": published_by}
        )
        PolicyVersion.objects.create(
            organization=organization,
            kind=kind,
            version=1,
            title=title,
            content=content,
            is_current=True,
            published_at=now,
            published_by=published_by,
        )


def save_draft(*, organization, kind: str, title: str, content: str, actor, request=None) -> PolicyDraft:
    draft, _ = PolicyDraft.objects.update_or_create(
        organization=organization,
        kind=kind,
        defaults={"title": title, "content": content, "updated_by": actor},
    )
    log_action(actor=actor, action="policy.draft.update", target=draft, metadata={"kind": kind}, request=request)
    return draft


def publish_policy(*, organization, kind: str, actor, request=None) -> PolicyVersion:
    """Snapshots the draft into a new current version. Every member -
    including the publisher - must then accept it before continuing."""
    draft = PolicyDraft.objects.filter(organization=organization, kind=kind).first()
    if draft is None or not draft.title.strip() or not draft.content.strip():
        raise ValidationError("Write a title and content for this policy before publishing it.")
    with transaction.atomic():
        current = (
            PolicyVersion.objects.select_for_update()
            .filter(organization=organization, kind=kind, is_current=True)
            .first()
        )
        if current is not None and current.title == draft.title and current.content == draft.content:
            raise ValidationError("There are no changes to publish since the current version.")
        latest = PolicyVersion.objects.filter(organization=organization, kind=kind).aggregate(n=Max("version"))["n"]
        PolicyVersion.objects.filter(organization=organization, kind=kind, is_current=True).update(is_current=False)
        version = PolicyVersion.objects.create(
            organization=organization,
            kind=kind,
            version=(latest or 0) + 1,
            title=draft.title,
            content=draft.content,
            is_current=True,
            published_at=timezone.now(),
            published_by=actor,
        )
        log_action(
            actor=actor,
            action="policy.publish",
            target=version,
            metadata={"kind": kind, "version": version.version},
            request=request,
        )
    return version


def accept_policies(*, user, version_ids, request=None) -> list[PolicyAcceptance]:
    """Records acceptance of the given current versions. Must cover every
    version the user still has pending - accepting only some would leave
    them gated anyway, so it's rejected outright rather than half-applied."""
    pending = list(pending_versions_for(user))
    pending_ids = {version.id for version in pending}
    requested = set(version_ids)
    current_ids = set(current_versions_for(user.organization).values_list("id", flat=True))
    if not requested <= current_ids:
        raise ValidationError({"version_ids": ["Only the current version of each policy can be accepted."]})
    if not pending_ids <= requested:
        raise ValidationError({"version_ids": ["Every pending policy must be accepted."]})
    acceptances = []
    with transaction.atomic():
        for version in pending:
            acceptance, _ = PolicyAcceptance.objects.get_or_create(version=version, user=user)
            acceptances.append(acceptance)
            log_action(
                actor=user,
                action="policy.accept",
                target=version,
                metadata={"kind": version.kind, "version": version.version},
                request=request,
            )
    return acceptances


def overview_for(organization) -> list[dict]:
    """Per kind: the draft, the current version, and how many members have
    accepted it - for the admin Settings > Policies tab."""
    from accounts.models import User

    member_count = User.objects.filter(organization=organization, is_active=True).count()
    drafts = {draft.kind: draft for draft in PolicyDraft.objects.filter(organization=organization)}
    currents = {version.kind: version for version in current_versions_for(organization)}
    rows = []
    for kind in PolicyKind.values:
        draft = drafts.get(kind)
        current = currents.get(kind)
        accepted_count = (
            current.acceptances.filter(user__is_active=True).count() if current is not None else 0
        )
        rows.append(
            {
                "kind": kind,
                "draft": draft,
                "current": current,
                "accepted_count": accepted_count,
                "member_count": member_count,
                "has_unpublished_changes": draft is not None
                and (current is None or draft.title != current.title or draft.content != current.content),
            }
        )
    return rows
