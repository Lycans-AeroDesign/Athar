"""Read-only public links to an article or SOP, for people without an Athar
account (a sponsor, a new member before they're invited, ...).

Creating a link needs:
- the organization's share_links_enabled switch (off by default);
- share_link.create;
- being able to see the item yourself, and for an article, it being PUBLISHED;
- for a RESTRICTED item, the type's edit override (article.update /
  sop.update) - restricted content is only shared on purpose, by someone
  who could change its visibility anyway.

A link opens only while all of this still holds - checked on every view,
not just at creation (link_target):
- not revoked, not expired;
- the organization is active and still has sharing switched on;
- its creator is still an active member with share_link.create;
- the item exists, isn't in the trash, and (for an article) is published;
- if the item is RESTRICTED now, its creator holds the override above. So a
  plain member's link stops when the item is later made restricted.

Revoking: the link's creator, or share_link.manage.
"""

import datetime
import re
from uuid import UUID

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import ScopedRateThrottle

from audit.services import log_action
from files.models import StoredFile
from organization.models import OrganizationSettings

from . import visibility as visibility_rules
from .models import Article, ArticleAttachment, ShareLink, Sop, SopAttachment, Visibility

CREATE_PERMISSION = "share_link.create"
MANAGE_PERMISSION = "share_link.manage"

SHAREABLE = {"article": Article, "sop": Sop}
# Needed to share an item that is RESTRICTED (decided per type).
RESTRICTED_SHARE_PERMISSION = {"article": "article.update", "sop": "sop.update"}
ATTACHMENTS = {"article": (ArticleAttachment, "article"), "sop": (SopAttachment, "sop")}

EXPIRY_CHOICES_DAYS = (1, 7, 30, 90)

_SALT = "athar.knowledge.share_link"
_ID_HEX_LENGTH = 32
_FILE_ID_RE = re.compile(
    r"/api/v1/files/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/download/"
)


# --- Tokens ------------------------------------------------------------------


def _signature(link_id_hex: str) -> str:
    return salted_hmac(_SALT, link_id_hex, algorithm="sha256").hexdigest()[:32]


def token_for(link: ShareLink) -> str:
    return f"{link.pk.hex}{_signature(link.pk.hex)}"


def link_for_token(token: str) -> ShareLink | None:
    """The link a token names, or None for anything malformed or forged.
    Doesn't say whether the link may be opened - see link_target."""
    if len(token) != _ID_HEX_LENGTH * 2 or not re.fullmatch(r"[0-9a-f]+", token):
        return None
    id_hex, signature = token[:_ID_HEX_LENGTH], token[_ID_HEX_LENGTH:]
    if not constant_time_compare(signature, _signature(id_hex)):
        return None
    return ShareLink.objects.select_related("organization", "created_by", "content_type").filter(pk=id_hex).first()


# --- Rules ---------------------------------------------------------------------


def sharing_enabled(organization) -> bool:
    return OrganizationSettings.load(organization).share_links_enabled


def _model_name(link: ShareLink) -> str:
    return link.content_type.model


def _shareable_state_ok(model_name: str, instance) -> bool:
    if instance is None or getattr(instance, "deleted_at", None) is not None:
        return False
    if model_name == "article" and instance.status != Article.Status.PUBLISHED:
        return False
    return True


def link_target(link: ShareLink | None):
    """The item `link` shows right now, or None if it may not be opened."""
    if link is None or link.revoked_at is not None:
        return None
    if link.expires_at is not None and link.expires_at <= timezone.now():
        return None
    if not link.organization.is_active or not sharing_enabled(link.organization):
        return None
    creator = link.created_by
    if creator is None or not creator.is_active or not creator.has_permission(CREATE_PERMISSION):
        return None
    model_name = _model_name(link)
    model = SHAREABLE.get(model_name)
    if model is None:
        return None
    # objects, not the base manager: a trashed item stays unreachable.
    instance = model.objects.filter(pk=link.object_id, organization=link.organization).first()
    if not _shareable_state_ok(model_name, instance):
        return None
    if instance.visibility == Visibility.RESTRICTED and not creator.has_permission(
        RESTRICTED_SHARE_PERMISSION[model_name]
    ):
        return None
    return instance


def can_manage(actor, link: ShareLink) -> bool:
    return link.created_by_id == actor.id or actor.has_permission(MANAGE_PERMISSION)


def resolve_shareable(actor, model_name: str, object_id):
    """The item `actor` wants to share, after every creation rule."""
    model = SHAREABLE.get(model_name)
    if model is None:
        raise ValidationError({"type": f"Must be one of: {', '.join(SHAREABLE)}."})
    instance = model.objects.filter(pk=object_id, organization=actor.organization).first()
    if instance is None or not visibility_rules.can_view_instance(actor, model_name, instance):
        raise ValidationError({"object_id": "No such item."})
    if not _shareable_state_ok(model_name, instance):
        raise ValidationError({"object_id": "Only published articles can be shared."})
    return instance


def create_link(*, actor, model_name: str, object_id, label: str = "", expires_in_days: int | None, request=None):
    if not sharing_enabled(actor.organization):
        raise PermissionDenied("Public links are switched off for this organization.")
    if not actor.has_permission(CREATE_PERMISSION):
        raise PermissionDenied("Creating public links requires share_link.create.")
    instance = resolve_shareable(actor, model_name, object_id)
    if instance.visibility == Visibility.RESTRICTED and not actor.has_permission(
        RESTRICTED_SHARE_PERMISSION[model_name]
    ):
        raise PermissionDenied(f"Sharing restricted content requires {RESTRICTED_SHARE_PERMISSION[model_name]}.")
    if expires_in_days is not None and expires_in_days not in EXPIRY_CHOICES_DAYS:
        raise ValidationError({"expires_in_days": f"Must be one of {EXPIRY_CHOICES_DAYS}, or null for never."})
    link = ShareLink.objects.create(
        organization=actor.organization,
        content_type=ContentType.objects.get_for_model(type(instance)),
        object_id=instance.pk,
        label=label.strip(),
        created_by=actor,
        expires_at=timezone.now() + datetime.timedelta(days=expires_in_days) if expires_in_days else None,
    )
    log_action(
        actor=actor,
        action="share_link.create",
        target=instance,
        metadata={"share_link_id": str(link.pk), "label": link.label, "expires_at": _iso(link.expires_at)},
        request=request,
    )
    return link


def revoke_link(*, link: ShareLink, actor, request=None) -> ShareLink:
    if not can_manage(actor, link):
        raise PermissionDenied("Only the link's creator or share_link.manage can revoke it.")
    if link.revoked_at is None:
        link.revoked_at = timezone.now()
        link.revoked_by = actor
        link.save(update_fields=["revoked_at", "revoked_by", "updated_at"])
        log_action(
            actor=actor,
            action="share_link.revoke",
            metadata={"share_link_id": str(link.pk), "label": link.label, "object_id": str(link.object_id)},
            request=request,
        )
    return link


def links_for(actor, *, model_name: str | None = None, object_id=None, include_inactive: bool = False):
    """Links `actor` may manage: their own, or every one in the organization
    with share_link.manage."""
    queryset = ShareLink.objects.filter(organization=actor.organization).select_related("created_by", "content_type")
    if not actor.has_permission(MANAGE_PERMISSION):
        queryset = queryset.filter(created_by=actor)
    if model_name:
        queryset = queryset.filter(content_type__model=model_name, content_type__app_label="knowledge")
    if object_id:
        queryset = queryset.filter(object_id=object_id)
    if not include_inactive:
        queryset = queryset.filter(revoked_at__isnull=True).exclude(expires_at__lte=timezone.now())
    return queryset


# A repeat open by the same visitor within this window isn't counted again
# (a refresh, or the page loading its data twice).
VIEW_DEDUPE_WINDOW = datetime.timedelta(minutes=30)


def _viewer_key(request) -> str:
    ident = ScopedRateThrottle().get_ident(request)  # client IP, honoring NUM_PROXIES
    user_agent = request.META.get("HTTP_USER_AGENT", "")[:300]
    return salted_hmac(_SALT + ".viewer", f"{ident}|{user_agent}", algorithm="sha256").hexdigest()


def record_view(link: ShareLink, request) -> None:
    """Counts the open unless this same visitor was the last one, within
    VIEW_DEDUPE_WINDOW. One conditional UPDATE, so two simultaneous requests
    from one visitor still count once: the second waits for the first's row
    lock, then no longer matches."""
    now = timezone.now()
    viewer = _viewer_key(request)
    counted = (
        ShareLink.objects.filter(pk=link.pk)
        .exclude(last_viewer_key=viewer, last_viewed_at__gt=now - VIEW_DEDUPE_WINDOW)
        .update(view_count=F("view_count") + 1, last_viewed_at=now, last_viewer_key=viewer)
    )
    if not counted:
        ShareLink.objects.filter(pk=link.pk).update(last_viewed_at=now)


# --- Public payload -------------------------------------------------------------


def shared_file_ids(model_name: str, instance) -> set[str]:
    """Files a share-link viewer may download: the item's attachments and
    files embedded in its markdown - nothing else in the organization."""
    attachment_model, field = ATTACHMENTS[model_name]
    ids = {str(pk) for pk in attachment_model.objects.filter(**{field: instance}).values_list("file_id", flat=True)}
    texts = [instance.content, getattr(instance, "safety_notes", "")]
    for text in texts:
        ids.update(match.lower() for match in _FILE_ID_RE.findall(text or ""))
    return ids


def shared_file(link: ShareLink, instance, file_id: UUID | str) -> StoredFile | None:
    if str(file_id).lower() not in shared_file_ids(_model_name(link), instance):
        return None
    return StoredFile.objects.filter(pk=file_id, organization=link.organization).first()


def attachments_of(model_name: str, instance) -> list[StoredFile]:
    attachment_model, field = ATTACHMENTS[model_name]
    return [
        attachment.file for attachment in attachment_model.objects.filter(**{field: instance}).select_related("file")
    ]


def _iso(value) -> str | None:
    return value.isoformat() if value else None
