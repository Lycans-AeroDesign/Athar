"""Restores an organization from one of its backup archives (see
services.build_org_backup_archive) - the counterpart to services.py.

Scope: everything the archive holds - members (with their password hashes,
so they log in exactly as before), roles and role assignments, invitation
codes, organization settings/branding, policies and acceptances, every
knowledge/engineering/training type, relations, grants, bookmarks,
attachments, the underlying files, and the audit log. The goal is that an
organization can be rebuilt from its archive alone, including on a fresh
server (see views.RestoreJobUploadView).

Restoring is a wipe-and-replace at the org scope: every row this module
knows how to restore is deleted for the target organization, then re-created
from the archive with its *original* primary key, so cross-references
between restored rows (an Article's category_id, a KnowledgeRelation's
object_id, ...) line up without an id-remapping pass. Exceptions, each
deliberate:

- Users are matched, never deleted: an archived user is matched to an
  existing member by id, then by email (so the admin who set up a fresh
  server under the same email becomes "themselves" from the archive), and
  updated in place; anyone else is created. Members who aren't in the
  archive are deactivated, not deleted - deleting accounts is irreversible,
  deactivating isn't. User ids are the one thing that *is* remapped (see
  _RestoreContext.user_id).
- The admin running the restore (`actor`) is never deactivated, keeps their
  current password, and always ends up holding organization.manage - a
  restore can't lock out the person doing it.
- StoredFiles are never wiped (see _restore_files) and the audit log is only
  ever appended to (see _restore_audit_log) - existing history is never lost
  to a restore.
- is_staff/is_superuser are never exported or restored - those are
  instance-operator flags, not organization data.

The archive is untrusted input - an uploaded archive can be hand-edited -
so nothing in it is allowed to reach outside this organization: every
reference to a parent row, user, file, or generic-FK target is checked
against what was actually restored into (or already belongs to) this
organization, and anything that doesn't resolve is skipped. A primary key
that already belongs to another organization's row fails the insert, which
rolls the whole restore back (it runs in one transaction).

Archives made before a given column/file existed restore with that piece
left at its default, never as an error - e.g. an archive with no password
column restores new accounts with an unusable password (counted in the
summary as users_without_password; an admin can send them reset links).
"""

import ast
import csv
import io
import ipaddress
import json
import sys
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import UTC

from django.contrib.contenttypes.models import ContentType
from django.core.files import File
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify

from accounts.models import InvitationCode, User
from audit.models import AuditLog
from files.models import StoredFile
from knowledge.models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Bookmark,
    Category,
    Component,
    ComponentAttachment,
    ComponentCategory,
    Document,
    Failure,
    FailureAttachment,
    KnowledgeRelation,
    Project,
    ProjectAttachment,
    Question,
    QuestionAttachment,
    RestrictedAccessGrant,
    Sop,
    SopAttachment,
    StorageLocation,
    Tag,
    Test,
    TestAttachment,
    Visibility,
)
from organization.models import OrganizationSettings
from policies.models import PolicyAcceptance, PolicyDraft, PolicyKind, PolicyVersion
from rbac.models import Permission, Role, RolePermission, UserRole
from rbac.services import seed_rbac_for_organization
from training.models import (
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseModule,
    CourseResource,
    LearningObjective,
    Lesson,
    LessonKnowledgeReference,
    LessonProgress,
)

# Article/lesson bodies can be far bigger than csv's 128KB default field limit.
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

ADMIN_PERMISSION = "organization.manage"

# Reverse-dependency order (leaves first) - see this module's own docstring.
# Training is its own independent tree (LessonKnowledgeReference points INTO
# knowledge content via a plain generic FK, no DB constraint - see that
# model's own docstring on why - so it's fine deleted in either order
# relative to the knowledge block below).
_DELETE_SPECS = [
    (LessonProgress, "enrollment__organization"),
    (CourseEnrollment, "organization"),
    (LessonKnowledgeReference, "lesson__module__course__organization"),
    (CourseResource, "lesson__module__course__organization"),
    (LearningObjective, "lesson__module__course__organization"),
    (Lesson, "module__course__organization"),
    (CourseModule, "course__organization"),
    (Course, "organization"),
    (CourseCategory, "organization"),
    (ArticleAttachment, "article__organization"),
    (QuestionAttachment, "question__organization"),
    (ProjectAttachment, "project__organization"),
    (ComponentAttachment, "component__organization"),
    (FailureAttachment, "failure__organization"),
    (SopAttachment, "sop__organization"),
    (TestAttachment, "test__organization"),
    (Bookmark, "organization"),
    (RestrictedAccessGrant, "organization"),
    (KnowledgeRelation, "organization"),
    (Answer, "question__organization"),
    (Question, "organization"),
    (ArticleRevision, "article__organization"),
    (Article, "organization"),
    (Document, "organization"),
    (Test, "organization"),
    (Sop, "organization"),
    (Failure, "organization"),
    (Component, "organization"),
    (ComponentCategory, "organization"),
    (StorageLocation, "organization"),
    (Project, "organization"),
    (Tag, "organization"),
    (Category, "organization"),
]

# Every model whose rows keep their archive id, with the lookup that scopes
# it to an organization and the CSV it comes from - drives the timestamp
# pass (_restore_timestamps), which only ever touches rows that verifiably
# belong to the target organization.
_TIMESTAMP_SPECS = [
    (StoredFile, "organization", "files_metadata.csv"),
    (Role, "organization", "roles.csv"),
    (UserRole, "role__organization", "user_roles.csv"),
    (RolePermission, "role__organization", "role_permissions.csv"),
    (InvitationCode, "organization", "invitation_codes.csv"),
    (Tag, "organization", "tags.csv"),
    (Category, "organization", "categories.csv"),
    (Project, "organization", "projects.csv"),
    (ComponentCategory, "organization", "component_categories.csv"),
    (StorageLocation, "organization", "storage_locations.csv"),
    (Component, "organization", "components.csv"),
    (Failure, "organization", "failures.csv"),
    (Sop, "organization", "sops.csv"),
    (Test, "organization", "tests.csv"),
    (Document, "organization", "documents.csv"),
    (Article, "organization", "articles.csv"),
    (ArticleRevision, "article__organization", "article_revisions.csv"),
    (Question, "organization", "questions.csv"),
    (Answer, "question__organization", "answers.csv"),
    (KnowledgeRelation, "organization", "knowledge_relations.csv"),
    (RestrictedAccessGrant, "organization", "restricted_access_grants.csv"),
    (Bookmark, "organization", "bookmarks.csv"),
    (ArticleAttachment, "article__organization", "article_attachments.csv"),
    (QuestionAttachment, "question__organization", "question_attachments.csv"),
    (ProjectAttachment, "project__organization", "project_attachments.csv"),
    (ComponentAttachment, "component__organization", "component_attachments.csv"),
    (FailureAttachment, "failure__organization", "failure_attachments.csv"),
    (SopAttachment, "sop__organization", "sop_attachments.csv"),
    (TestAttachment, "test__organization", "test_attachments.csv"),
    (CourseCategory, "organization", "course_categories.csv"),
    (Course, "organization", "courses.csv"),
    (CourseModule, "course__organization", "course_modules.csv"),
    (Lesson, "module__course__organization", "lessons.csv"),
    (LearningObjective, "lesson__module__course__organization", "learning_objectives.csv"),
    (CourseResource, "lesson__module__course__organization", "course_resources.csv"),
    (LessonKnowledgeReference, "lesson__module__course__organization", "lesson_knowledge_references.csv"),
    (CourseEnrollment, "organization", "course_enrollments.csv"),
    (LessonProgress, "enrollment__organization", "lesson_progress.csv"),
    (PolicyDraft, "organization", "policy_drafts.csv"),
    (PolicyVersion, "organization", "policy_versions.csv"),
    (PolicyAcceptance, "version__organization", "policy_acceptances.csv"),
    (AuditLog, "organization", "audit_log.csv"),
]

# Generic-FK targets a relation/grant/bookmark/lesson reference may point
# at, keyed by ContentType.model - anything else in an archive is skipped.
_GENERIC_TARGET_APPS = {
    "article": "knowledge",
    "question": "knowledge",
    "project": "knowledge",
    "component": "knowledge",
    "failure": "knowledge",
    "sop": "knowledge",
    "test": "knowledge",
    "document": "knowledge",
    "course": "training",
}


class RestoreError(Exception):
    """A problem with the archive itself, worded for the admin who ran the
    restore - surfaced as RestoreJob.error."""


@dataclass
class RestoreSummary:
    created: dict[str, int] = field(default_factory=dict)
    orphaned_user_refs: int = 0
    missing_files: int = 0
    deactivated_users: int = 0
    users_without_password: int = 0

    def as_dict(self) -> dict:
        return {
            "created": self.created,
            "orphaned_user_refs": self.orphaned_user_refs,
            "missing_files": self.missing_files,
            "deactivated_users": self.deactivated_users,
            "users_without_password": self.users_without_password,
        }


def read_manifest(zf: zipfile.ZipFile) -> dict:
    """{} for an archive made before manifest.json existed."""
    if "manifest.json" not in zf.namelist():
        return {}
    try:
        manifest = json.loads(zf.read("manifest.json"))
    except ValueError as exc:
        raise RestoreError("This backup's manifest.json is not valid JSON.") from exc
    return manifest if isinstance(manifest, dict) else {}


def _read_csv_rows(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    if filename not in zf.namelist():
        return []
    with zf.open(filename, "r") as raw:
        text_stream = io.TextIOWrapper(raw, encoding="utf-8")
        return list(csv.DictReader(text_stream))


def _uuid_or_none(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _int_or_default(value: str, default: int = 0) -> int:
    return int(value) if value else default


def _bool(value: str) -> bool:
    return value == "True"


def _date_or_none(value: str):
    return value[:10] if value else None


def _datetime_or_none(value: str | None):
    if not value:
        return None
    try:
        parsed = parse_datetime(value)
    except ValueError:
        return None
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, UTC)
    return parsed


def _json_or_default(value: str, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except ValueError:
        return default


class _RestoreContext:
    def __init__(self, organization, summary: RestoreSummary, actor=None):
        self.organization = organization
        self.summary = summary
        self.actor = actor
        # archive user id -> real user id in this organization. Starts as the
        # identity map over the org's current members (enough on its own for
        # an archive with no users.csv), then _restore_users adds the
        # archive's own ids, which can differ for a member matched by email.
        self.user_map = {
            user_id: user_id for user_id in User.objects.filter(organization=organization).values_list("id", flat=True)
        }
        self.content_type_by_model = {}
        # ContentType.model -> ids restored for it, so generic-FK rows can be
        # checked against what actually exists in this organization.
        self.restored_ids: dict[str, set[uuid.UUID]] = {name: set() for name in _GENERIC_TARGET_APPS}

    def user_id(self, raw: str | None) -> uuid.UUID | None:
        candidate = _uuid_or_none(raw)
        if candidate is None:
            return None
        mapped = self.user_map.get(candidate)
        if mapped is None:
            self.summary.orphaned_user_refs += 1
        return mapped

    def generic_target(self, model_name: str, raw_object_id: str):
        """(content_type, object_id) for a generic FK, or None when the
        target isn't a restorable type or wasn't restored into this org."""
        object_id = _uuid_or_none(raw_object_id)
        if model_name not in _GENERIC_TARGET_APPS or object_id not in self.restored_ids[model_name]:
            return None
        if model_name not in self.content_type_by_model:
            self.content_type_by_model[model_name] = ContentType.objects.get(
                app_label=_GENERIC_TARGET_APPS[model_name], model=model_name
            )
        return self.content_type_by_model[model_name], object_id

    def track(self, model_name: str, ids) -> None:
        self.restored_ids[model_name].update(ids)


def _restore_users(ctx: _RestoreContext, zf: zipfile.ZipFile) -> list[dict]:
    rows = _read_csv_rows(zf, "users.csv")
    if not rows:
        return rows
    organization, actor = ctx.organization, ctx.actor

    archive_ids = {_uuid_or_none(row["id"]) for row in rows} - {None}
    emails = {row["email"].strip().lower() for row in rows}
    foreign = User.objects.exclude(organization=organization).filter(id__in=archive_ids) | User.objects.exclude(
        organization=organization
    ).filter(email__in=emails)
    foreign_emails = sorted(foreign.values_list("email", flat=True).distinct())
    if foreign_emails:
        sample = ", ".join(foreign_emails[:3]) + (" ..." if len(foreign_emails) > 3 else "")
        raise RestoreError(
            f"{len(foreign_emails)} account(s) in this backup belong to another organization on this server: {sample}"
        )

    members = {user.id: user for user in User.objects.filter(organization=organization)}
    members_by_email = {user.email.lower(): user for user in members.values()}
    kept_ids = set()
    created = 0
    for row in rows:
        archive_id = _uuid_or_none(row["id"])
        email = row["email"].strip().lower()
        if archive_id is None or not email:
            continue
        user = members.get(archive_id) or members_by_email.get(email)
        is_actor = actor is not None and user is not None and user.pk == actor.pk
        password = row.get("password", "")
        if user is None:
            user = User(id=archive_id, organization=organization, email=email)
            if password:
                user.password = password
            else:
                user.set_unusable_password()
                ctx.summary.users_without_password += 1
            created += 1
        elif password and not is_actor:
            user.password = password

        if not is_actor:
            user.email = email
            user.is_active = _bool(row["is_active"])
        username = row.get("username") or None
        if username and User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists():
            username = user.username if user.pk in members else None
        user.username = username
        user.first_name = row["first_name"]
        user.last_name = row["last_name"]
        user.title = row["title"]
        if "preferences" in row:
            preferences = _json_or_default(row["preferences"], {})
            user.preferences = preferences if isinstance(preferences, dict) else {}
        if "last_login" in row:
            user.last_login = _datetime_or_none(row["last_login"])
        user.save()

        date_joined = _datetime_or_none(row.get("date_joined"))
        if date_joined:
            User.objects.filter(pk=user.pk).update(date_joined=date_joined)
        members[user.pk] = user
        members_by_email[user.email] = user
        ctx.user_map[archive_id] = user.pk
        kept_ids.add(user.pk)

    deactivate = User.objects.filter(organization=organization, is_active=True).exclude(pk__in=kept_ids)
    if actor is not None:
        deactivate = deactivate.exclude(pk=actor.pk)
    ctx.summary.deactivated_users = deactivate.update(is_active=False)
    ctx.summary.created["users"] = created
    return rows


def _restore_profile_pictures(ctx: _RestoreContext, user_rows: list[dict], files_by_id) -> None:
    for row in user_rows:
        if "profile_picture_id" not in row:
            return
        user_id = ctx.user_map.get(_uuid_or_none(row["id"]))
        if user_id is not None:
            picture = files_by_id.get(_uuid_or_none(row["profile_picture_id"]))
            User.objects.filter(pk=user_id).update(profile_picture=picture)


def _restore_roles(ctx: _RestoreContext, zf: zipfile.ZipFile) -> None:
    if "roles.csv" not in zf.namelist():
        return
    organization = ctx.organization
    # Cascades to UserRole and RolePermission.
    Role.objects.filter(organization=organization).delete()

    roles_by_id, roles_by_name = {}, {}
    for row in _read_csv_rows(zf, "roles.csv"):
        role = Role.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=organization,
            name=row["name"],
            description=row["description"],
            is_system=_bool(row["is_system"]),
        )
        roles_by_id[role.id] = role
        roles_by_name[role.name] = role
    ctx.summary.created["roles"] = len(roles_by_id)

    def role_for(row):
        return roles_by_id.get(_uuid_or_none(row.get("role_id"))) or roles_by_name.get(row["role_name"])

    permissions = {p.codename: p for p in Permission.objects.all()}
    count = 0
    for row in _read_csv_rows(zf, "role_permissions.csv"):
        role, permission = role_for(row), permissions.get(row["permission_codename"])
        if role is None or permission is None:
            continue
        RolePermission.objects.create(
            id=_uuid_or_none(row["id"]),
            role=role,
            permission=permission,
            granted_by_id=ctx.user_id(row.get("granted_by_id")),
        )
        count += 1
    ctx.summary.created["role_permissions"] = count

    users_by_email = dict(User.objects.filter(organization=organization).values_list("email", "id"))
    count = 0
    for row in _read_csv_rows(zf, "user_roles.csv"):
        # Archives from before user_id was exported only carry the email.
        user_id = ctx.user_map.get(_uuid_or_none(row.get("user_id"))) or users_by_email.get(
            row["user_email"].strip().lower()
        )
        role = role_for(row)
        if user_id is None or role is None:
            continue
        UserRole.objects.create(
            id=_uuid_or_none(row["id"]), user_id=user_id, role=role, granted_by_id=ctx.user_id(row.get("granted_by_id"))
        )
        count += 1
    ctx.summary.created["user_roles"] = count

    # Re-adds any standard role/permission the archive predates.
    seed_rbac_for_organization(organization)

    actor = ctx.actor
    if actor is not None and not actor.has_permission(ADMIN_PERMISSION):
        admin_role = (
            Role.objects.filter(organization=organization, permissions__codename=ADMIN_PERMISSION)
            .order_by("-is_system", "name")
            .first()
        )
        UserRole.objects.get_or_create(user=actor, role=admin_role)


def _restore_invitation_codes(ctx: _RestoreContext, zf: zipfile.ZipFile) -> None:
    if "invitation_codes.csv" not in zf.namelist():
        return
    InvitationCode.objects.filter(organization=ctx.organization).delete()
    rows = _read_csv_rows(zf, "invitation_codes.csv")
    # Codes are unique server-wide - one another organization now holds is
    # skipped rather than failing the whole restore.
    taken = set(InvitationCode.objects.filter(code__in=[row["code"] for row in rows]).values_list("code", flat=True))
    count = 0
    for row in rows:
        if row["code"] in taken:
            continue
        InvitationCode.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            code=row["code"],
            max_uses=_int_or_default(row["max_uses"], 1),
            uses_count=_int_or_default(row["uses_count"]),
            expires_at=_datetime_or_none(row["expires_at"]),
            revoked_at=_datetime_or_none(row["revoked_at"]),
            created_by_id=ctx.user_id(row.get("created_by_id")),
        )
        count += 1
    ctx.summary.created["invitation_codes"] = count


def _restore_organization_settings(ctx: _RestoreContext, zf: zipfile.ZipFile, files_by_id) -> None:
    rows = _read_csv_rows(zf, "organization_settings.csv")
    if not rows:
        return
    row = rows[0]
    settings_row = OrganizationSettings.load(ctx.organization)
    settings_row.name = row["name"]
    for color_field in ("primary_color", "secondary_color", "primary_color_dark", "secondary_color_dark"):
        if row.get(color_field):
            setattr(settings_row, color_field, row[color_field][:7])
    if "logo_id" in row:
        settings_row.logo = files_by_id.get(_uuid_or_none(row["logo_id"]))
        settings_row.favicon = files_by_id.get(_uuid_or_none(row["favicon_id"]))
    if row.get("product_tour_enabled"):
        settings_row.product_tour_enabled = _bool(row["product_tour_enabled"])
    settings_row.save()


def _restore_tags(ctx: _RestoreContext, zf: zipfile.ZipFile) -> dict[uuid.UUID, Tag]:
    tags_by_id = {}
    for row in _read_csv_rows(zf, "tags.csv"):
        tag = Tag.objects.create(id=_uuid_or_none(row["id"]), organization=ctx.organization, name=row["name"])
        tags_by_id[tag.id] = tag
    ctx.summary.created["tags"] = len(tags_by_id)
    return tags_by_id


def _restore_categories(ctx: _RestoreContext, zf: zipfile.ZipFile) -> dict[uuid.UUID, Category]:
    categories_by_id = {}
    for row in _read_csv_rows(zf, "categories.csv"):
        category = Category.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
        )
        categories_by_id[category.id] = category
    ctx.summary.created["categories"] = len(categories_by_id)
    return categories_by_id


def _set_tags(obj, ctx: _RestoreContext, row: dict, tags_by_id: dict) -> None:
    ids = [_uuid_or_none(v) for v in row.get("tag_ids", "").split(";") if v]
    obj.tags.set([tags_by_id[i] for i in ids if i in tags_by_id])


def _set_co_authors(obj, ctx: _RestoreContext, row: dict) -> None:
    """Archives made before co-authors existed have no co_author_ids column -
    row.get() makes that an empty list, not an error."""
    ids = [ctx.user_id(v) for v in row.get("co_author_ids", "").split(";") if v]
    obj.co_authors.set([i for i in ids if i is not None])


def _restore_projects(ctx, zf, tags_by_id) -> dict[uuid.UUID, Project]:
    projects_by_id = {}
    for row in _read_csv_rows(zf, "projects.csv"):
        project = Project.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            description=row["description"],
            status=row["status"],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        _set_tags(project, ctx, row, tags_by_id)
        projects_by_id[project.id] = project
    ctx.summary.created["projects"] = len(projects_by_id)
    ctx.track("project", projects_by_id)
    return projects_by_id


def _restore_component_categories(ctx, zf) -> dict[uuid.UUID, ComponentCategory] | None:
    """None for an archive made before components had their own category
    list - _restore_components then rebuilds one from each row's category
    name instead."""
    if "component_categories.csv" not in zf.namelist():
        return None
    categories_by_id = {}
    for row in _read_csv_rows(zf, "component_categories.csv"):
        category = ComponentCategory.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
        )
        categories_by_id[category.id] = category
    ctx.summary.created["component_categories"] = len(categories_by_id)
    return categories_by_id


def _restore_storage_locations(ctx, zf) -> dict[uuid.UUID, StorageLocation]:
    locations_by_id = {}
    for row in _read_csv_rows(zf, "storage_locations.csv"):
        location = StorageLocation.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            description=row["description"],
        )
        locations_by_id[location.id] = location
    ctx.summary.created["storage_locations"] = len(locations_by_id)
    return locations_by_id


def _legacy_component_category(ctx, name: str, cache: dict) -> ComponentCategory | None:
    if not name:
        return None
    key = name.strip().lower()
    if key not in cache:
        cache[key] = ComponentCategory.objects.filter(organization=ctx.organization, name__iexact=name).first() or (
            ComponentCategory.objects.create(organization=ctx.organization, name=name, slug=slugify(name)[:120] or "item")
        )
    return cache[key]


def _restore_components(
    ctx, zf, component_categories_by_id, locations_by_id, tags_by_id, files_by_id
) -> dict[uuid.UUID, Component]:
    components_by_id = {}
    legacy_categories: dict = {}
    for row in _read_csv_rows(zf, "components.csv"):
        if component_categories_by_id is None:
            category = _legacy_component_category(ctx, row.get("category", ""), legacy_categories)
        else:
            category = component_categories_by_id.get(_uuid_or_none(row["category_id"]))
        # .get(): the inventory columns (and quantity/link/photo) are absent
        # from archives made before they were backed up.
        min_quantity = row.get("min_quantity", "")
        component = Component.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            category=category,
            photo=files_by_id.get(_uuid_or_none(row.get("photo_id", ""))),
            manufacturer=row["manufacturer"],
            part_number=row["part_number"],
            link=row.get("link", ""),
            quantity_available=_int_or_default(row.get("quantity_available", "")),
            status=row["status"],
            inventory_type=row.get("inventory_type", ""),
            location=locations_by_id.get(_uuid_or_none(row.get("location_id", ""))),
            unit=row.get("unit", ""),
            condition=row.get("condition", ""),
            stock_status=row.get("stock_status", ""),
            min_quantity=int(min_quantity) if min_quantity else None,
            inventory_notes=row.get("inventory_notes", ""),
            summary=row["summary"],
            specifications=json.loads(row["specifications"]) if row["specifications"] else [],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
            updated_by_id=ctx.user_id(row.get("updated_by_id", "")),
        )
        _set_tags(component, ctx, row, tags_by_id)
        components_by_id[component.id] = component
    ctx.summary.created["components"] = len(components_by_id)
    ctx.track("component", components_by_id)
    return components_by_id


def _restore_failures(ctx, zf, components_by_id, projects_by_id) -> set[uuid.UUID]:
    ids = set()
    for row in _read_csv_rows(zf, "failures.csv"):
        failure = Failure.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            component=components_by_id.get(_uuid_or_none(row["component_id"])),
            project=projects_by_id.get(_uuid_or_none(row["project_id"])),
            aircraft=row["aircraft"],
            date=_date_or_none(row["date"]),
            severity=row["severity"],
            status=row["status"],
            summary=row["summary"],
            root_cause=row["root_cause"],
            corrective_action=row["corrective_action"],
            preventive_action=row["preventive_action"],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        ids.add(failure.id)
    ctx.summary.created["failures"] = len(ids)
    ctx.track("failure", ids)
    return ids


def _restore_sops(ctx, zf, categories_by_id, tags_by_id) -> set[uuid.UUID]:
    ids = set()
    for row in _read_csv_rows(zf, "sops.csv"):
        sop = Sop.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            category=categories_by_id.get(_uuid_or_none(row["category_id"])),
            mandatory=_bool(row["mandatory"]),
            safety_notes=row["safety_notes"],
            content=row["content"],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        _set_tags(sop, ctx, row, tags_by_id)
        ids.add(sop.id)
    ctx.summary.created["sops"] = len(ids)
    ctx.track("sop", ids)
    return ids


def _restore_tests(ctx, zf, projects_by_id, tags_by_id) -> set[uuid.UUID]:
    ids = set()
    for row in _read_csv_rows(zf, "tests.csv"):
        test = Test.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            test_type=row["test_type"],
            date=_date_or_none(row["date"]),
            location=row["location"],
            project=projects_by_id.get(_uuid_or_none(row["project_id"])),
            objective=row["objective"],
            status=row["status"],
            configuration=row["configuration"],
            procedure=row["procedure"],
            results=row["results"],
            pass_fail=row["pass_fail"],
            conclusion=row["conclusion"],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        _set_tags(test, ctx, row, tags_by_id)
        ids.add(test.id)
    ctx.summary.created["tests"] = len(ids)
    ctx.track("test", ids)
    return ids


def _restore_files(ctx: _RestoreContext, zf: zipfile.ZipFile) -> dict[uuid.UUID, StoredFile]:
    # StoredFiles are never wiped up front (not in _DELETE_SPECS): a file
    # uploaded since the backup may still be someone's profile picture, and
    # a file's bytes never change after upload, so a row that still exists
    # under the same id is reused as-is rather than re-inserted (which would
    # hit its pkey).
    existing = {f.id: f for f in StoredFile.objects.filter(organization=ctx.organization)}
    names = zf.namelist()
    files_by_id = {}
    for row in _read_csv_rows(zf, "files_metadata.csv"):
        file_id = _uuid_or_none(row["id"])
        if file_id is None:
            continue
        # Everything restored is referenced by restored content, so it must
        # stay confirmed or files.services.delete_unconfirmed_files would
        # reclaim it 24h later. Archives from before confirmed_at was
        # exported have no way to tell a staged upload apart, so they count
        # as confirmed too.
        confirmed_at = _datetime_or_none(row["confirmed_at"]) if "confirmed_at" in row else timezone.now()
        if file_id in existing:
            stored_file = existing[file_id]
            if stored_file.confirmed_at is None and confirmed_at is not None:
                stored_file.confirmed_at = confirmed_at
                stored_file.save(update_fields=["confirmed_at"])
            files_by_id[file_id] = stored_file
            continue
        stored_file = StoredFile(
            id=file_id,
            organization=ctx.organization,
            original_filename=row["original_filename"],
            content_type=row["content_type"],
            size=_int_or_default(row["size"]),
            uploaded_by_id=ctx.user_id(row["uploaded_by_id"]),
            required_permission=row["required_permission"],
            confirmed_at=confirmed_at,
        )
        # The bytes live at files/<id>/<original_filename> in the archive
        # (see services._write_files) - find it by prefix rather than
        # reconstructing the exact name, in case the filename needed
        # sanitizing on write.
        prefix = f"files/{file_id}/"
        matches = [n for n in names if n.startswith(prefix)]
        if not matches:
            ctx.summary.missing_files += 1
            continue
        with zf.open(matches[0], "r") as source:
            stored_file.file.save(row["original_filename"], File(source), save=False)
        stored_file.save()
        files_by_id[file_id] = stored_file
    ctx.summary.created["files"] = len(files_by_id)
    return files_by_id


def _restore_documents(ctx, zf, categories_by_id, tags_by_id, files_by_id) -> None:
    ids = set()
    for row in _read_csv_rows(zf, "documents.csv"):
        document = Document.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            description=row["description"],
            doc_type=row["doc_type"],
            source=row["source"],
            author=row["author"],
            external_organization=row["external_organization"],
            publication_date=_date_or_none(row["publication_date"]),
            url=row["url"],
            file=files_by_id.get(_uuid_or_none(row["file_id"])),
            category=categories_by_id.get(_uuid_or_none(row["category_id"])),
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        _set_tags(document, ctx, row, tags_by_id)
        ids.add(document.id)
    ctx.summary.created["documents"] = len(ids)
    ctx.track("document", ids)


def _restore_articles(ctx, zf, categories_by_id, tags_by_id) -> dict[uuid.UUID, Article]:
    articles_by_id = {}
    for row in _read_csv_rows(zf, "articles.csv"):
        article = Article.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            slug=row["slug"],
            excerpt=row["excerpt"],
            content=row["content"],
            status=row["status"],
            visibility=row["visibility"],
            category=categories_by_id.get(_uuid_or_none(row["category_id"])),
            author_id=ctx.user_id(row["author_id"]),
            published_at=row["published_at"] or None,
        )
        _set_tags(article, ctx, row, tags_by_id)
        _set_co_authors(article, ctx, row)
        articles_by_id[article.id] = article
    ctx.summary.created["articles"] = len(articles_by_id)
    ctx.track("article", articles_by_id)
    return articles_by_id


def _restore_article_revisions(ctx, zf, articles_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "article_revisions.csv"):
        article = articles_by_id.get(_uuid_or_none(row["article_id"]))
        if article is None:
            continue
        ArticleRevision.objects.create(
            id=_uuid_or_none(row["id"]),
            article=article,
            title=row["title"],
            content=row["content"],
            edited_by_id=ctx.user_id(row["edited_by_id"]),
        )
        count += 1
    ctx.summary.created["article_revisions"] = count


def _restore_questions(ctx, zf, tags_by_id) -> dict[uuid.UUID, Question]:
    questions_by_id = {}
    for row in _read_csv_rows(zf, "questions.csv"):
        # accepted_answer/promoted_to_article point at rows restored later -
        # filled in afterwards by _restore_question_links.
        question = Question.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            body=row["body"],
            status=row["status"],
            visibility=row["visibility"],
            author_id=ctx.user_id(row["author_id"]),
        )
        _set_tags(question, ctx, row, tags_by_id)
        _set_co_authors(question, ctx, row)
        questions_by_id[question.id] = question
    ctx.summary.created["questions"] = len(questions_by_id)
    ctx.track("question", questions_by_id)
    return questions_by_id


def _restore_answers(ctx, zf, questions_by_id) -> dict[uuid.UUID, uuid.UUID]:
    """answer id -> its question id."""
    answers = {}
    for row in _read_csv_rows(zf, "answers.csv"):
        question = questions_by_id.get(_uuid_or_none(row["question_id"]))
        if question is None:
            continue
        answer = Answer.objects.create(
            id=_uuid_or_none(row["id"]),
            question=question,
            body=row["body"],
            author_id=ctx.user_id(row["author_id"]),
        )
        answers[answer.id] = question.id
    ctx.summary.created["answers"] = len(answers)
    return answers


def _restore_question_links(ctx, zf, answers, articles_by_id) -> None:
    # Archives from before these columns were exported simply leave them unset.
    for row in _read_csv_rows(zf, "questions.csv"):
        question_id = _uuid_or_none(row["id"])
        accepted_answer_id = _uuid_or_none(row.get("accepted_answer_id"))
        promoted_to_article_id = _uuid_or_none(row.get("promoted_to_article_id"))
        updates = {}
        if accepted_answer_id is not None and answers.get(accepted_answer_id) == question_id:
            updates["accepted_answer_id"] = accepted_answer_id
        if promoted_to_article_id in articles_by_id:
            updates["promoted_to_article_id"] = promoted_to_article_id
        if updates:
            Question.objects.filter(pk=question_id, organization=ctx.organization).update(**updates)


def _restore_relations(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "knowledge_relations.csv"):
        source = ctx.generic_target(row["source_type"], row["source_object_id"])
        target = ctx.generic_target(row["target_type"], row["target_object_id"])
        if source is None or target is None:
            continue
        KnowledgeRelation.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            source_content_type=source[0],
            source_object_id=source[1],
            target_content_type=target[0],
            target_object_id=target[1],
            relation_type=row["relation_type"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        count += 1
    ctx.summary.created["knowledge_relations"] = count


def _restore_grants(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "restricted_access_grants.csv"):
        granted_user_id = ctx.user_id(row["granted_user_id"])
        target = ctx.generic_target(row["content_type"], row["object_id"])
        if granted_user_id is None or target is None:
            # Meaningless without a grantee - a grant naming nobody is just
            # noise, unlike an author/creator FK, which is fine as null.
            continue
        RestrictedAccessGrant.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            content_type=target[0],
            object_id=target[1],
            granted_user_id=granted_user_id,
            granted_by_id=ctx.user_id(row["granted_by_id"]),
        )
        count += 1
    ctx.summary.created["restricted_access_grants"] = count


def _restore_bookmarks(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "bookmarks.csv"):
        user_id = ctx.user_id(row["user_id"])
        target = ctx.generic_target(row["content_type"], row["object_id"])
        if user_id is None or target is None:
            continue
        Bookmark.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            content_type=target[0],
            object_id=target[1],
            user_id=user_id,
        )
        count += 1
    ctx.summary.created["bookmarks"] = count


def _restore_course_categories(ctx: _RestoreContext, zf: zipfile.ZipFile) -> dict[uuid.UUID, CourseCategory]:
    categories_by_id = {}
    for row in _read_csv_rows(zf, "course_categories.csv"):
        category = CourseCategory.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
        )
        categories_by_id[category.id] = category
    ctx.summary.created["course_categories"] = len(categories_by_id)
    return categories_by_id


def _restore_courses(ctx, zf, course_categories_by_id, files_by_id) -> dict[uuid.UUID, Course]:
    courses_by_id = {}
    for row in _read_csv_rows(zf, "courses.csv"):
        course = Course.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            title=row["title"],
            slug=row["slug"],
            short_description=row["short_description"],
            description=row["description"],
            cover_image=files_by_id.get(_uuid_or_none(row["cover_image_id"])),
            category=course_categories_by_id.get(_uuid_or_none(row["category_id"])),
            difficulty=row["difficulty"],
            estimated_minutes=_int_or_default(row["estimated_minutes"]),
            status=row["status"],
            # .get(): archives made before courses had a visibility column
            # restore as PUBLIC, which is what every course was back then.
            visibility=row.get("visibility") or Visibility.PUBLIC,
            author_id=ctx.user_id(row["author_id"]),
            published_at=row["published_at"] or None,
        )
        courses_by_id[course.id] = course
    ctx.summary.created["courses"] = len(courses_by_id)
    ctx.track("course", courses_by_id)
    return courses_by_id


def _restore_course_modules(ctx, zf, courses_by_id) -> dict[uuid.UUID, CourseModule]:
    modules_by_id = {}
    for row in _read_csv_rows(zf, "course_modules.csv"):
        course = courses_by_id.get(_uuid_or_none(row["course_id"]))
        if course is None:
            continue
        module = CourseModule.objects.create(
            id=_uuid_or_none(row["id"]),
            course=course,
            title=row["title"],
            description=row["description"],
            order=_int_or_default(row["order"]),
            estimated_minutes=_int_or_default(row["estimated_minutes"]),
        )
        modules_by_id[module.id] = module
    ctx.summary.created["course_modules"] = len(modules_by_id)
    return modules_by_id


def _restore_lessons(ctx, zf, modules_by_id) -> dict[uuid.UUID, Lesson]:
    lessons_by_id = {}
    for row in _read_csv_rows(zf, "lessons.csv"):
        module = modules_by_id.get(_uuid_or_none(row["module_id"]))
        if module is None:
            continue
        lesson = Lesson.objects.create(
            id=_uuid_or_none(row["id"]),
            module=module,
            title=row["title"],
            short_description=row["short_description"],
            lesson_type=row["lesson_type"],
            content=row["content"],
            order=_int_or_default(row["order"]),
            estimated_minutes=_int_or_default(row["estimated_minutes"]),
            is_required=_bool(row["is_required"]),
        )
        lessons_by_id[lesson.id] = lesson
    ctx.summary.created["lessons"] = len(lessons_by_id)
    return lessons_by_id


def _restore_learning_objectives(ctx, zf, lessons_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "learning_objectives.csv"):
        lesson = lessons_by_id.get(_uuid_or_none(row["lesson_id"]))
        if lesson is None:
            continue
        LearningObjective.objects.create(
            id=_uuid_or_none(row["id"]), lesson=lesson, text=row["text"], order=_int_or_default(row["order"])
        )
        count += 1
    ctx.summary.created["learning_objectives"] = count


def _restore_course_resources(ctx, zf, lessons_by_id, files_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "course_resources.csv"):
        lesson = lessons_by_id.get(_uuid_or_none(row["lesson_id"]))
        if lesson is None:
            continue
        CourseResource.objects.create(
            id=_uuid_or_none(row["id"]),
            lesson=lesson,
            title=row["title"],
            description=row["description"],
            resource_type=row["resource_type"],
            provider=row["provider"],
            url=row["url"],
            stored_file=files_by_id.get(_uuid_or_none(row["stored_file_id"])),
            is_primary=_bool(row["is_primary"]),
            order=_int_or_default(row["order"]),
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        count += 1
    ctx.summary.created["course_resources"] = count


def _restore_lesson_knowledge_references(ctx, zf, lessons_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "lesson_knowledge_references.csv"):
        lesson = lessons_by_id.get(_uuid_or_none(row["lesson_id"]))
        target = ctx.generic_target(row["content_type"], row["object_id"])
        if lesson is None or target is None:
            continue
        LessonKnowledgeReference.objects.create(
            id=_uuid_or_none(row["id"]),
            lesson=lesson,
            content_type=target[0],
            object_id=target[1],
            note=row["note"],
            order=_int_or_default(row["order"]),
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        count += 1
    ctx.summary.created["lesson_knowledge_references"] = count


def _restore_course_enrollments(ctx, zf, courses_by_id) -> dict[uuid.UUID, CourseEnrollment]:
    enrollments_by_id = {}
    for row in _read_csv_rows(zf, "course_enrollments.csv"):
        course = courses_by_id.get(_uuid_or_none(row["course_id"]))
        # CourseEnrollment.user is NOT NULL (unlike an author/creator FK) -
        # an enrollment naming nobody can't be created at all, same
        # reasoning _restore_grants/_restore_bookmarks skip on a missing
        # required user.
        user_id = ctx.user_id(row["user_id"])
        if course is None or user_id is None:
            continue
        enrollment = CourseEnrollment.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            course=course,
            user_id=user_id,
            status=row["status"],
            completed_at=row["completed_at"] or None,
        )
        enrollments_by_id[enrollment.id] = enrollment
    ctx.summary.created["course_enrollments"] = len(enrollments_by_id)
    return enrollments_by_id


def _restore_lesson_progress(ctx, zf, enrollments_by_id, lessons_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "lesson_progress.csv"):
        enrollment = enrollments_by_id.get(_uuid_or_none(row["enrollment_id"]))
        lesson = lessons_by_id.get(_uuid_or_none(row["lesson_id"]))
        if enrollment is None or lesson is None:
            continue
        LessonProgress.objects.create(id=_uuid_or_none(row["id"]), enrollment=enrollment, lesson=lesson)
        count += 1
    ctx.summary.created["lesson_progress"] = count


def _restore_attachments(ctx, zf, model, filename: str, parent_field: str, parent_ids, files_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, filename):
        file_obj = files_by_id.get(_uuid_or_none(row["file_id"]))
        parent_id = _uuid_or_none(row[f"{parent_field}_id"])
        if file_obj is None or parent_id not in parent_ids:
            continue
        model.objects.create(
            id=_uuid_or_none(row["id"]),
            uploaded_by_id=ctx.user_id(row["uploaded_by_id"]),
            file=file_obj,
            **{parent_field + "_id": parent_id},
        )
        count += 1
    ctx.summary.created[filename.removesuffix(".csv")] = count


def _restore_policies(ctx: _RestoreContext, zf: zipfile.ZipFile) -> None:
    if "policy_versions.csv" not in zf.namelist():
        return
    organization = ctx.organization
    kinds = set(PolicyKind.values)
    PolicyDraft.objects.filter(organization=organization).delete()
    # Cascades to PolicyAcceptance.
    PolicyVersion.objects.filter(organization=organization).delete()

    count = 0
    for row in _read_csv_rows(zf, "policy_drafts.csv"):
        if row["kind"] not in kinds:
            continue
        PolicyDraft.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=organization,
            kind=row["kind"],
            title=row["title"],
            content=row["content"],
            updated_by_id=ctx.user_id(row["updated_by_id"]),
        )
        count += 1
    ctx.summary.created["policy_drafts"] = count

    version_ids = set()
    for row in _read_csv_rows(zf, "policy_versions.csv"):
        if row["kind"] not in kinds:
            continue
        version = PolicyVersion.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=organization,
            kind=row["kind"],
            version=_int_or_default(row["version"], 1),
            title=row["title"],
            content=row["content"],
            is_current=_bool(row["is_current"]),
            published_at=_datetime_or_none(row["published_at"]) or timezone.now(),
            published_by_id=ctx.user_id(row["published_by_id"]),
        )
        version_ids.add(version.id)
    ctx.summary.created["policy_versions"] = len(version_ids)

    count = 0
    for row in _read_csv_rows(zf, "policy_acceptances.csv"):
        version_id = _uuid_or_none(row["version_id"])
        user_id = ctx.user_id(row["user_id"])
        if version_id not in version_ids or user_id is None:
            continue
        PolicyAcceptance.objects.create(id=_uuid_or_none(row["id"]), version_id=version_id, user_id=user_id)
        count += 1
    ctx.summary.created["policy_acceptances"] = count


def _parse_audit_metadata(value: str) -> dict:
    # Archives from before metadata was exported as JSON hold Python's repr.
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except ValueError:
        try:
            parsed = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            parsed = {"raw": value}
    return parsed if isinstance(parsed, dict) else {"raw": parsed}


def _ip_or_none(value: str):
    try:
        return str(ipaddress.ip_address(value)) if value else None
    except ValueError:
        return None


def _restore_audit_log(ctx: _RestoreContext, zf: zipfile.ZipFile) -> None:
    """Append-only: entries already in this organization's log are kept as
    they are, and only archived entries the log doesn't have yet are added
    back - each marked restored_from_backup, so a restored entry can always
    be told apart from one this server recorded itself."""
    rows = _read_csv_rows(zf, "audit_log.csv")
    if not rows:
        return
    existing = set(AuditLog.objects.filter(organization=ctx.organization).values_list("id", flat=True))
    content_types = {f"{ct.app_label}.{ct.model}": ct for ct in ContentType.objects.all()}
    entries = []
    for row in rows:
        entry_id = _uuid_or_none(row["id"])
        if entry_id is None or entry_id in existing:
            continue
        metadata = _parse_audit_metadata(row["metadata"])
        metadata["restored_from_backup"] = True
        target_type = content_types.get(row.get("target_type", ""))
        entries.append(
            AuditLog(
                id=entry_id,
                organization=ctx.organization,
                actor_id=ctx.user_map.get(_uuid_or_none(row.get("actor_id"))),
                action=row["action"][:100],
                target_content_type=target_type,
                target_object_id=(row.get("target_object_id") or None) if target_type else None,
                target_repr=row["target_repr"][:255],
                metadata=metadata,
                ip_address=_ip_or_none(row["ip_address"]),
                user_agent=row.get("user_agent", ""),
            )
        )
    AuditLog.objects.bulk_create(entries, batch_size=1000)
    ctx.summary.created["audit_log"] = len(entries)


def _restore_timestamps(ctx: _RestoreContext, zf: zipfile.ZipFile) -> None:
    """auto_now/auto_now_add fields ignore whatever .create() is given, so
    the original timestamps go back in afterwards. bulk_update writes values
    as-is (no pre_save), and only rows that verifiably belong to this
    organization are touched."""
    for model, org_lookup, filename in _TIMESTAMP_SPECS:
        auto_fields = [
            f.name
            for f in model._meta.concrete_fields
            if getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False)
        ]
        rows = _read_csv_rows(zf, filename)
        if not rows:
            continue
        present = [name for name in auto_fields if name in rows[0]]
        if not present:
            continue
        values_by_pk = {}
        for row in rows:
            pk = _uuid_or_none(row["id"])
            values = {name: _datetime_or_none(row[name]) for name in present}
            if pk is not None and all(values.values()):
                values_by_pk[pk] = values
        owned = set(
            model.objects.filter(pk__in=values_by_pk, **{org_lookup: ctx.organization}).values_list("pk", flat=True)
        )
        objs = []
        for pk in owned:
            obj = model(pk=pk)
            for name, value in values_by_pk[pk].items():
                setattr(obj, name, value)
            objs.append(obj)
        if objs:
            model.objects.bulk_update(objs, present, batch_size=1000)


@transaction.atomic
def restore_org_backup_archive(organization, archive_file, actor=None) -> RestoreSummary:
    """`archive_file` is an open, seekable file-like object positioned at
    the start of a .zip produced by services.build_org_backup_archive.
    `actor` is the admin running the restore (see this module's docstring
    for what that protects). Everything below runs in one transaction - a
    failure partway through rolls the whole restore back rather than
    leaving the organization half-wiped."""
    summary = RestoreSummary()
    ctx = _RestoreContext(organization, summary, actor)

    with zipfile.ZipFile(archive_file) as zf:
        read_manifest(zf)  # validates it, if present
        user_rows = _restore_users(ctx, zf)

        for model, org_lookup in _DELETE_SPECS:
            model.objects.filter(**{org_lookup: organization}).delete()

        files_by_id = _restore_files(ctx, zf)
        _restore_profile_pictures(ctx, user_rows, files_by_id)
        _restore_organization_settings(ctx, zf, files_by_id)
        _restore_roles(ctx, zf)
        _restore_invitation_codes(ctx, zf)

        tags_by_id = _restore_tags(ctx, zf)
        categories_by_id = _restore_categories(ctx, zf)
        projects_by_id = _restore_projects(ctx, zf, tags_by_id)
        component_categories_by_id = _restore_component_categories(ctx, zf)
        locations_by_id = _restore_storage_locations(ctx, zf)
        components_by_id = _restore_components(
            ctx, zf, component_categories_by_id, locations_by_id, tags_by_id, files_by_id
        )
        failure_ids = _restore_failures(ctx, zf, components_by_id, projects_by_id)
        sop_ids = _restore_sops(ctx, zf, categories_by_id, tags_by_id)
        test_ids = _restore_tests(ctx, zf, projects_by_id, tags_by_id)
        _restore_documents(ctx, zf, categories_by_id, tags_by_id, files_by_id)
        course_categories_by_id = _restore_course_categories(ctx, zf)
        courses_by_id = _restore_courses(ctx, zf, course_categories_by_id, files_by_id)
        modules_by_id = _restore_course_modules(ctx, zf, courses_by_id)
        lessons_by_id = _restore_lessons(ctx, zf, modules_by_id)
        _restore_learning_objectives(ctx, zf, lessons_by_id)
        _restore_course_resources(ctx, zf, lessons_by_id, files_by_id)
        enrollments_by_id = _restore_course_enrollments(ctx, zf, courses_by_id)
        _restore_lesson_progress(ctx, zf, enrollments_by_id, lessons_by_id)
        articles_by_id = _restore_articles(ctx, zf, categories_by_id, tags_by_id)
        _restore_article_revisions(ctx, zf, articles_by_id)
        questions_by_id = _restore_questions(ctx, zf, tags_by_id)
        answers = _restore_answers(ctx, zf, questions_by_id)
        _restore_question_links(ctx, zf, answers, articles_by_id)
        # Generic-FK rows last, once every possible target has been restored.
        _restore_lesson_knowledge_references(ctx, zf, lessons_by_id)
        _restore_relations(ctx, zf)
        _restore_grants(ctx, zf)
        _restore_bookmarks(ctx, zf)
        _restore_attachments(ctx, zf, ArticleAttachment, "article_attachments.csv", "article", articles_by_id, files_by_id)
        _restore_attachments(
            ctx, zf, QuestionAttachment, "question_attachments.csv", "question", questions_by_id, files_by_id
        )
        _restore_attachments(ctx, zf, ProjectAttachment, "project_attachments.csv", "project", projects_by_id, files_by_id)
        _restore_attachments(
            ctx, zf, ComponentAttachment, "component_attachments.csv", "component", components_by_id, files_by_id
        )
        _restore_attachments(ctx, zf, FailureAttachment, "failure_attachments.csv", "failure", failure_ids, files_by_id)
        _restore_attachments(ctx, zf, SopAttachment, "sop_attachments.csv", "sop", sop_ids, files_by_id)
        _restore_attachments(ctx, zf, TestAttachment, "test_attachments.csv", "test", test_ids, files_by_id)
        _restore_policies(ctx, zf)
        _restore_audit_log(ctx, zf)
        _restore_timestamps(ctx, zf)

    return summary
