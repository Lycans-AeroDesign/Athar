"""Cross-organization administrative statistics and actions for instance operators.

Everything here is metadata (counts, byte sizes, timestamps, account info). Never read or
return organization content (articles, answers, file names, ...)."""

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.conf import settings
from rest_framework.exceptions import PermissionDenied, ValidationError

import shutil

from accounts.models import User
from accounts.services import create_password_reset_link
from audit.models import AuditLog
from audit.services import log_action
from backups.models import BackupJob
from files.models import StoredFile
from knowledge.models import Article, Component, Document, Failure, Project, Question, Sop, Test
from organization.models import Organization
from .models import PlatformSettings, organization_registration_enabled
from training.models import Course

CONTENT_MODELS = {
    "articles": Article,
    "questions": Question,
    "projects": Project,
    "components": Component,
    "failures": Failure,
    "sops": Sop,
    "tests": Test,
    "documents": Document,
    "courses": Course,
}


def _grouped(queryset, **aggregates):
    return {row["organization_id"]: row for row in queryset.values("organization_id").annotate(**aggregates)}


def _backup_bytes(organization_ids) -> dict:
    sizes: dict = {}
    jobs = BackupJob.objects.filter(organization_id__in=organization_ids).exclude(archive="").exclude(archive=None)
    for job in jobs.only("organization_id", "archive"):
        try:
            sizes[job.organization_id] = sizes.get(job.organization_id, 0) + job.archive.size
        except (OSError, ValueError):
            continue  # archive file missing from storage
    return sizes


def organization_stats(organizations) -> list[dict]:
    """One dict per organization in `organizations` (a list/queryset), using grouped queries."""
    organizations = list(organizations)
    ids = [org.id for org in organizations]

    users = _grouped(
        User.objects.filter(organization_id__in=ids),
        total=Count("id"),
        active=Count("id", filter=Q(is_active=True)),
    )
    files = _grouped(
        StoredFile.objects.filter(organization_id__in=ids),
        total_bytes=Sum("size"),
        file_count=Count("id"),
    )
    activity = _grouped(AuditLog.objects.filter(organization_id__in=ids), last=Max("created_at"))
    counts = {
        key: _grouped(model.objects.filter(organization_id__in=ids), n=Count("id"))
        for key, model in CONTENT_MODELS.items()
    }
    backups = _backup_bytes(ids)
    admins: dict = {}
    for user in User.objects.filter(
        organization_id__in=ids, is_active=True, roles__name="Organization Admin"
    ).order_by("date_joined"):
        admins.setdefault(user.organization_id, []).append(user.email)

    result = []
    for org in organizations:
        file_bytes = (files.get(org.id) or {}).get("total_bytes") or 0
        backup_bytes = backups.get(org.id, 0)
        result.append(
            {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "is_active": org.is_active,
                "created_at": org.created_at,
                "user_count": (users.get(org.id) or {}).get("total", 0),
                "active_user_count": (users.get(org.id) or {}).get("active", 0),
                "admin_emails": admins.get(org.id, []),
                "file_count": (files.get(org.id) or {}).get("file_count", 0),
                "file_bytes": file_bytes,
                "backup_bytes": backup_bytes,
                "total_bytes": file_bytes + backup_bytes,
                "last_activity": (activity.get(org.id) or {}).get("last"),
                "content_counts": {key: (counts[key].get(org.id) or {}).get("n", 0) for key in CONTENT_MODELS},
            }
        )
    return result


def disk_usage() -> dict:
    """Space on the filesystem hosting MEDIA_ROOT - i.e. the disk the uploads
    actually land on (the VM's disk for local-disk storage installs). None
    values when files are served from object storage (S3); the serializer
    passes those through so the frontend can drop the disk card instead of
    showing a number that doesn't match reality."""
    blanks = {"disk_total_bytes": None, "disk_used_bytes": None, "disk_free_bytes": None}
    if "django.core.files.storage.FileSystemStorage" not in settings.STORAGES["default"]["BACKEND"]:
        return blanks
    try:
        usage = shutil.disk_usage(settings.MEDIA_ROOT)
    except OSError:
        return blanks
    return {
        "disk_total_bytes": usage.total,
        "disk_used_bytes": usage.used,
        "disk_free_bytes": usage.free,
    }


def instance_summary() -> dict:
    stats = organization_stats(Organization.objects.all())
    return {
        "organization_count": len(stats),
        "active_organization_count": sum(1 for row in stats if row["is_active"]),
        "user_count": sum(row["user_count"] for row in stats),
        "active_user_count": sum(row["active_user_count"] for row in stats),
        "file_bytes": sum(row["file_bytes"] for row in stats),
        "backup_bytes": sum(row["backup_bytes"] for row in stats),
        "total_bytes": sum(row["total_bytes"] for row in stats),
        **disk_usage(),
    }


def organization_users(organization: Organization):
    """Account metadata only: no content, no preferences, no profile text."""
    return (
        User.objects.filter(organization=organization)
        .annotate(last_activity=Max("audit_logs__created_at"))
        .prefetch_related("roles")
        .order_by("email")
    )


@transaction.atomic
def set_organization_active(*, organization: Organization, is_active: bool, actor, request=None) -> Organization:
    if not is_active and organization.id == actor.organization_id:
        raise PermissionDenied("You can't suspend your own organization.")
    organization.is_active = is_active
    organization.save(update_fields=["is_active", "updated_at"])
    log_action(
        actor=actor,
        action="platform.organization.reactivate" if is_active else "platform.organization.suspend",
        target=organization,
        request=request,
        organization=organization,
    )
    return organization


@transaction.atomic
def set_user_active(*, user: User, is_active: bool, actor, request=None) -> User:
    if user.id == actor.id:
        raise PermissionDenied("You can't block or unblock your own account.")
    if not is_active and user.is_superuser:
        raise ValidationError("Platform administrators can't be blocked from here.")
    user.is_active = is_active
    user.save(update_fields=["is_active"])
    log_action(
        actor=actor,
        action="platform.user.unblock" if is_active else "platform.user.block",
        target=user,
        request=request,
        organization=user.organization,
    )
    return user


def issue_password_reset_link(*, user: User, actor, request=None):
    link, token = create_password_reset_link(user=user, actor=actor, request=request)
    log_action(
        actor=actor,
        action="platform.user.password_reset_link",
        target=user,
        request=request,
        organization=user.organization,
    )
    return link, token


def get_platform_settings() -> dict:
    return {"organization_registration_enabled": organization_registration_enabled()}


@transaction.atomic
def set_organization_registration_enabled(*, enabled: bool, actor, request=None) -> dict:
    row = PlatformSettings.load()
    row.organization_registration_enabled = enabled
    row.save(update_fields=["organization_registration_enabled", "updated_at"])
    log_action(
        actor=actor,
        action="platform.settings.organization_registration",
        metadata={"enabled": enabled},
        request=request,
    )
    return get_platform_settings()
