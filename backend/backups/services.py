"""Builds a per-organization data+files export archive - see
BackupJob/tasks.py. Streams each org-scoped model via .iterator() into a CSV
file inside the archive, and streams each of the org's uploaded files into
the same archive, so memory use stays flat regardless of how much data or
how many files the org has - nothing here ever loads a whole table or a
whole file into memory at once.

Each model's exported columns are an explicit whitelist (not "every field
the model happens to have") so a new, possibly sensitive field added to a
model later doesn't silently end up in every org's backup without a
deliberate decision to include it - same reasoning AuthorSerializer's own
docstring gives for not just reusing the real User model shape.
"""

import csv
import io
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from django.core.files import File
from django.utils import timezone

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
    Tag,
    Test,
    TestAttachment,
)
from organization.models import OrganizationSettings
from rbac.models import Role, RolePermission, UserRole

from .models import BackupJob


def _s(value) -> str:
    return "" if value is None else str(value)


def _tags(obj) -> str:
    return ";".join(tag.name for tag in obj.tags.all())


def _tag_ids(obj) -> str:
    return ";".join(str(tag.id) for tag in obj.tags.all())


def _content_type_name(obj) -> str:
    return obj.content_type.model


def _json(value) -> str:
    # Real JSON (not Python's str() repr, which uses single-quoted literal
    # syntax) - restore.py needs json.loads() to read this back correctly.
    return json.dumps(value)


def _attachment_spec(model, filename: str, parent_field: str, organization):
    # No own `organization` FK on any attachment model (see core.models.
    # OrganizationScopedModel's docstring - reached only through an
    # already-scoped parent), so scoping goes through that parent instead.
    return (
        model.objects.filter(**{f"{parent_field}__organization": organization}).select_related("uploaded_by"),
        filename,
        [
            ("id", lambda o: _s(o.id)),
            (f"{parent_field}_id", lambda o: _s(getattr(o, f"{parent_field}_id"))),
            ("file_id", lambda o: _s(o.file_id)),
            ("uploaded_by_id", lambda o: _s(o.uploaded_by_id)),
            ("uploaded_by_email", lambda o: _s(o.uploaded_by and o.uploaded_by.email)),
            ("created_at", lambda o: _s(o.created_at)),
        ],
    )


# Each entry: (queryset, csv filename, [(header, extractor(obj) -> str), ...]).
# `queryset` is already org-filtered and (where relevant) prefetches whatever
# the extractors need, so iterating it via .iterator() below never triggers
# per-row queries.
def _export_specs(organization):
    return [
        (
            User.objects.filter(organization=organization).order_by("date_joined"),
            "users.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("email", lambda o: o.email),
                ("username", lambda o: _s(o.username)),
                ("first_name", lambda o: o.first_name),
                ("last_name", lambda o: o.last_name),
                ("title", lambda o: o.title),
                ("is_active", lambda o: _s(o.is_active)),
                ("date_joined", lambda o: _s(o.date_joined)),
            ],
        ),
        (
            Role.objects.filter(organization=organization),
            "roles.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("name", lambda o: o.name),
                ("description", lambda o: o.description),
                ("is_system", lambda o: _s(o.is_system)),
            ],
        ),
        (
            UserRole.objects.filter(role__organization=organization).select_related("user", "role"),
            "user_roles.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("user_email", lambda o: o.user.email),
                ("role_name", lambda o: o.role.name),
                ("granted_at", lambda o: _s(o.granted_at)),
            ],
        ),
        (
            RolePermission.objects.filter(role__organization=organization).select_related("role", "permission"),
            "role_permissions.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("role_name", lambda o: o.role.name),
                ("permission_codename", lambda o: o.permission.codename),
                ("granted_at", lambda o: _s(o.granted_at)),
            ],
        ),
        (
            InvitationCode.objects.filter(organization=organization),
            "invitation_codes.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("code", lambda o: o.code),
                ("max_uses", lambda o: _s(o.max_uses)),
                ("uses_count", lambda o: _s(o.uses_count)),
                ("expires_at", lambda o: _s(o.expires_at)),
                ("revoked_at", lambda o: _s(o.revoked_at)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            Category.objects.filter(organization=organization),
            "categories.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("name", lambda o: o.name),
                ("slug", lambda o: o.slug),
                ("description", lambda o: o.description),
            ],
        ),
        (
            Tag.objects.filter(organization=organization),
            "tags.csv",
            [("id", lambda o: _s(o.id)), ("name", lambda o: o.name)],
        ),
        (
            Article.objects.filter(organization=organization)
            .select_related("category", "author")
            .prefetch_related("tags"),
            "articles.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("slug", lambda o: o.slug),
                ("excerpt", lambda o: o.excerpt),
                ("content", lambda o: o.content),
                ("status", lambda o: o.status),
                ("visibility", lambda o: o.visibility),
                ("category_id", lambda o: _s(o.category_id)),
                ("category", lambda o: _s(o.category and o.category.name)),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("author_id", lambda o: _s(o.author_id)),
                ("author_email", lambda o: _s(o.author and o.author.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
                ("published_at", lambda o: _s(o.published_at)),
            ],
        ),
        (
            ArticleRevision.objects.filter(article__organization=organization).select_related(
                "article", "edited_by"
            ),
            "article_revisions.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("article_id", lambda o: _s(o.article_id)),
                ("title", lambda o: o.title),
                ("content", lambda o: o.content),
                ("edited_by_id", lambda o: _s(o.edited_by_id)),
                ("edited_by_email", lambda o: _s(o.edited_by and o.edited_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            Question.objects.filter(organization=organization).select_related("author").prefetch_related("tags"),
            "questions.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("body", lambda o: o.body),
                ("status", lambda o: o.status),
                ("visibility", lambda o: o.visibility),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("author_id", lambda o: _s(o.author_id)),
                ("author_email", lambda o: _s(o.author and o.author.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Answer.objects.filter(question__organization=organization).select_related("question", "author"),
            "answers.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("question_id", lambda o: _s(o.question_id)),
                ("body", lambda o: o.body),
                ("author_id", lambda o: _s(o.author_id)),
                ("author_email", lambda o: _s(o.author and o.author.email)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            Project.objects.filter(organization=organization).select_related("created_by").prefetch_related("tags"),
            "projects.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("name", lambda o: o.name),
                ("description", lambda o: o.description),
                ("status", lambda o: o.status),
                ("visibility", lambda o: o.visibility),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Component.objects.filter(organization=organization)
            .select_related("category", "created_by")
            .prefetch_related("tags"),
            "components.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("name", lambda o: o.name),
                ("category_id", lambda o: _s(o.category_id)),
                ("category", lambda o: _s(o.category and o.category.name)),
                ("manufacturer", lambda o: o.manufacturer),
                ("part_number", lambda o: o.part_number),
                ("status", lambda o: o.status),
                ("summary", lambda o: o.summary),
                ("specifications", lambda o: _json(o.specifications)),
                ("visibility", lambda o: o.visibility),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Failure.objects.filter(organization=organization).select_related("component", "project", "created_by"),
            "failures.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("component_id", lambda o: _s(o.component_id)),
                ("component", lambda o: _s(o.component and o.component.name)),
                ("project_id", lambda o: _s(o.project_id)),
                ("project", lambda o: _s(o.project and o.project.name)),
                ("aircraft", lambda o: o.aircraft),
                ("date", lambda o: _s(o.date)),
                ("severity", lambda o: o.severity),
                ("status", lambda o: o.status),
                ("summary", lambda o: o.summary),
                ("root_cause", lambda o: o.root_cause),
                ("corrective_action", lambda o: o.corrective_action),
                ("preventive_action", lambda o: o.preventive_action),
                ("visibility", lambda o: o.visibility),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Sop.objects.filter(organization=organization).select_related("category", "created_by").prefetch_related(
                "tags"
            ),
            "sops.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("category_id", lambda o: _s(o.category_id)),
                ("category", lambda o: _s(o.category and o.category.name)),
                ("mandatory", lambda o: _s(o.mandatory)),
                ("safety_notes", lambda o: o.safety_notes),
                ("content", lambda o: o.content),
                ("visibility", lambda o: o.visibility),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Test.objects.filter(organization=organization).select_related("project", "created_by").prefetch_related(
                "tags"
            ),
            "tests.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("test_type", lambda o: o.test_type),
                ("date", lambda o: _s(o.date)),
                ("location", lambda o: o.location),
                ("project_id", lambda o: _s(o.project_id)),
                ("project", lambda o: _s(o.project and o.project.name)),
                ("objective", lambda o: o.objective),
                ("status", lambda o: o.status),
                ("configuration", lambda o: o.configuration),
                ("procedure", lambda o: o.procedure),
                ("results", lambda o: o.results),
                ("pass_fail", lambda o: o.pass_fail),
                ("conclusion", lambda o: o.conclusion),
                ("visibility", lambda o: o.visibility),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            Document.objects.filter(organization=organization)
            .select_related("category", "created_by", "file")
            .prefetch_related("tags"),
            "documents.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("title", lambda o: o.title),
                ("description", lambda o: o.description),
                ("doc_type", lambda o: o.doc_type),
                ("source", lambda o: o.source),
                ("author", lambda o: o.author),
                ("external_organization", lambda o: o.external_organization),
                ("publication_date", lambda o: _s(o.publication_date)),
                ("url", lambda o: o.url),
                ("file_id", lambda o: _s(o.file_id)),
                ("category_id", lambda o: _s(o.category_id)),
                ("category", lambda o: _s(o.category and o.category.name)),
                ("tag_ids", _tag_ids),
                ("tags", _tags),
                ("visibility", lambda o: o.visibility),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
                ("updated_at", lambda o: _s(o.updated_at)),
            ],
        ),
        (
            KnowledgeRelation.objects.filter(organization=organization).select_related(
                "source_content_type", "target_content_type", "created_by"
            ),
            "knowledge_relations.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("source_type", lambda o: o.source_content_type.model),
                ("source_object_id", lambda o: _s(o.source_object_id)),
                ("target_type", lambda o: o.target_content_type.model),
                ("target_object_id", lambda o: _s(o.target_object_id)),
                ("relation_type", lambda o: o.relation_type),
                ("created_by_id", lambda o: _s(o.created_by_id)),
                ("created_by_email", lambda o: _s(o.created_by and o.created_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            RestrictedAccessGrant.objects.filter(organization=organization).select_related(
                "content_type", "granted_user", "granted_by"
            ),
            "restricted_access_grants.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("content_type", _content_type_name),
                ("object_id", lambda o: _s(o.object_id)),
                ("granted_user_id", lambda o: _s(o.granted_user_id)),
                ("granted_user_email", lambda o: o.granted_user.email),
                ("granted_by_id", lambda o: _s(o.granted_by_id)),
                ("granted_by_email", lambda o: _s(o.granted_by and o.granted_by.email)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            Bookmark.objects.filter(organization=organization).select_related("content_type", "user"),
            "bookmarks.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("content_type", _content_type_name),
                ("object_id", lambda o: _s(o.object_id)),
                ("user_id", lambda o: _s(o.user_id)),
                ("user_email", lambda o: o.user.email),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        (
            StoredFile.objects.filter(organization=organization).select_related("uploaded_by"),
            "files_metadata.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("original_filename", lambda o: o.original_filename),
                ("content_type", lambda o: o.content_type),
                ("size", lambda o: _s(o.size)),
                ("uploaded_by_id", lambda o: _s(o.uploaded_by_id)),
                ("uploaded_by_email", lambda o: _s(o.uploaded_by and o.uploaded_by.email)),
                ("required_permission", lambda o: o.required_permission),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
        _attachment_spec(ArticleAttachment, "article_attachments.csv", "article", organization),
        _attachment_spec(QuestionAttachment, "question_attachments.csv", "question", organization),
        _attachment_spec(ProjectAttachment, "project_attachments.csv", "project", organization),
        _attachment_spec(ComponentAttachment, "component_attachments.csv", "component", organization),
        _attachment_spec(FailureAttachment, "failure_attachments.csv", "failure", organization),
        _attachment_spec(SopAttachment, "sop_attachments.csv", "sop", organization),
        _attachment_spec(TestAttachment, "test_attachments.csv", "test", organization),
        (
            AuditLog.objects.filter(organization=organization).select_related("actor"),
            "audit_log.csv",
            [
                ("id", lambda o: _s(o.id)),
                ("actor_email", lambda o: _s(o.actor and o.actor.email)),
                ("action", lambda o: o.action),
                ("target_repr", lambda o: o.target_repr),
                ("metadata", lambda o: _s(o.metadata)),
                ("ip_address", lambda o: _s(o.ip_address)),
                ("created_at", lambda o: _s(o.created_at)),
            ],
        ),
    ]


def _write_csv_entry(zf: zipfile.ZipFile, filename: str, columns, queryset) -> None:
    with zf.open(filename, "w") as raw:
        text_stream = io.TextIOWrapper(raw, encoding="utf-8", newline="")
        writer = csv.writer(text_stream)
        writer.writerow([header for header, _ in columns])
        for obj in queryset.iterator(chunk_size=2000):
            writer.writerow([extractor(obj) for _, extractor in columns])
        text_stream.flush()


def _write_organization_settings(zf: zipfile.ZipFile, organization) -> None:
    settings_row = OrganizationSettings.load(organization)
    with zf.open("organization_settings.csv", "w") as raw:
        text_stream = io.TextIOWrapper(raw, encoding="utf-8", newline="")
        writer = csv.writer(text_stream)
        writer.writerow(["name", "primary_domain", "primary_color", "secondary_color", "updated_at"])
        writer.writerow(
            [
                settings_row.name,
                settings_row.primary_domain,
                settings_row.primary_color,
                settings_row.secondary_color,
                _s(settings_row.updated_at),
            ]
        )
        text_stream.flush()


def _write_files(zf: zipfile.ZipFile, organization) -> None:
    for stored_file in StoredFile.objects.filter(organization=organization).iterator(chunk_size=500):
        if not stored_file.file:
            continue
        entry_name = f"files/{stored_file.id}/{stored_file.original_filename}"
        with stored_file.file.open("rb") as source, zf.open(entry_name, "w") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)


def build_org_backup_archive(job: BackupJob) -> None:
    """Writes the full export to a temp file on disk (never in memory, so
    this scales to a large org's data/files) then assigns it to
    `job.archive` - the caller (tasks.generate_org_backup) is responsible
    for job.save() afterward."""
    organization = job.organization
    with tempfile.TemporaryDirectory() as tmp_dir:
        archive_path = Path(tmp_dir) / f"{job.id}.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            _write_organization_settings(zf, organization)
            for queryset, filename, columns in _export_specs(organization):
                _write_csv_entry(zf, filename, columns, queryset)
            _write_files(zf, organization)

        with open(archive_path, "rb") as archive_file:
            job.archive.save(f"{job.id}.zip", File(archive_file), save=False)
