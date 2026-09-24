"""Restores an organization's content from one of its own backup archives
(see services.build_org_backup_archive) - the counterpart to services.py.

Scope, deliberately: this restores *content* only - Category, Tag, every
knowledge/engineering type, relations, restricted-access grants, bookmarks,
attachments, the underlying files, and every Training Center model (courses,
modules, lessons, objectives, resources, knowledge references, enrollments,
progress). It does **not** touch Users, Roles,
UserRole/RolePermission, InvitationCode, AuditLog, or OrganizationSettings.
Two reasons, not one corner cut for convenience:

1. User.password is never exported (see services.py's own docstring on why -
   a leaked backup must never be a credentials leak) - restoring a User row
   from this archive would recreate an account nobody could ever log into,
   which is worse than not restoring it at all.
2. Re-creating a User that still exists (same email) is a genuine correctness
   question this app has no answer for (merge? replace? which wins?) - far
   safer to leave identity/access rows alone and only re-link *content* back
   to whichever users still exist, by id.

Restoring is a full wipe-and-replace at the org scope: every row this module
knows how to restore is deleted for the target organization, then re-created
from the archive with its *original* primary key, so cross-references
between restored rows (an Article's category_id, a KnowledgeRelation's
object_id, ...) line up automatically without needing an id-remapping pass.
An FK to a User that no longer exists in this organization is set to null
(the same state that FK would already be in if that user were deleted
normally - see e.g. Article.author's on_delete=SET_NULL) rather than
failing the whole restore, and counted in the returned summary so the
caller can tell the admin "12 items restored, 2 authors no longer exist".

Two other known, deliberate gaps, both content the export itself never
captured in the first place (not something lost in restore specifically):
Question.accepted_answer/promoted_to_article (derived/secondary state, not
source content) come back unset, and every restored row's created_at is the
moment of the restore, not its original creation time - auto_now_add fields
ignore any value passed to .create() by design, and preserving the original
would need a second .update() pass per model that isn't worth the added
complexity here.
"""

import csv
import io
import json
import uuid
import zipfile
from dataclasses import dataclass, field

from django.contrib.contenttypes.models import ContentType
from django.core.files import File
from django.db import transaction

from accounts.models import User
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
    Visibility,
)
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
    (Project, "organization"),
    (Tag, "organization"),
    (Category, "organization"),
]


@dataclass
class RestoreSummary:
    created: dict[str, int] = field(default_factory=dict)
    orphaned_user_refs: int = 0
    missing_files: int = 0

    def as_dict(self) -> dict:
        return {"created": self.created, "orphaned_user_refs": self.orphaned_user_refs, "missing_files": self.missing_files}


def _read_csv_rows(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    if filename not in zf.namelist():
        return []
    with zf.open(filename, "r") as raw:
        text_stream = io.TextIOWrapper(raw, encoding="utf-8")
        return list(csv.DictReader(text_stream))


def _uuid_or_none(value: str) -> uuid.UUID | None:
    return uuid.UUID(value) if value else None


def _int_or_default(value: str, default: int = 0) -> int:
    return int(value) if value else default


def _bool(value: str) -> bool:
    return value == "True"


def _date_or_none(value: str):
    return value[:10] if value else None


class _RestoreContext:
    def __init__(self, organization, summary: RestoreSummary):
        self.organization = organization
        self.summary = summary
        # One query up front, checked in memory per-row from here on - far
        # cheaper than a .exists() query per FK across potentially thousands
        # of rows.
        self.user_ids = set(User.objects.filter(organization=organization).values_list("id", flat=True))
        self.content_type_by_model = {}

    def user_id(self, raw: str) -> uuid.UUID | None:
        candidate = _uuid_or_none(raw)
        if candidate is None:
            return None
        if candidate not in self.user_ids:
            self.summary.orphaned_user_refs += 1
            return None
        return candidate

    def content_type_for(self, model_name: str):
        if model_name not in self.content_type_by_model:
            # Every grant/bookmark target is a knowledge model except
            # training.Course, which can carry RestrictedAccessGrants too.
            app_label = "training" if model_name == "course" else "knowledge"
            self.content_type_by_model[model_name] = ContentType.objects.get(app_label=app_label, model=model_name)
        return self.content_type_by_model[model_name]


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
    return projects_by_id


def _restore_components(ctx, zf, categories_by_id, tags_by_id) -> dict[uuid.UUID, Component]:
    components_by_id = {}
    for row in _read_csv_rows(zf, "components.csv"):
        component = Component.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            name=row["name"],
            category=categories_by_id.get(_uuid_or_none(row["category_id"])),
            manufacturer=row["manufacturer"],
            part_number=row["part_number"],
            status=row["status"],
            summary=row["summary"],
            specifications=json.loads(row["specifications"]) if row["specifications"] else [],
            visibility=row["visibility"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        _set_tags(component, ctx, row, tags_by_id)
        components_by_id[component.id] = component
    ctx.summary.created["components"] = len(components_by_id)
    return components_by_id


def _restore_failures(ctx, zf, components_by_id, projects_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, "failures.csv"):
        Failure.objects.create(
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
        count += 1
    ctx.summary.created["failures"] = count


def _restore_sops(ctx, zf, categories_by_id, tags_by_id) -> None:
    count = 0
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
        count += 1
    ctx.summary.created["sops"] = count


def _restore_tests(ctx, zf, projects_by_id, tags_by_id) -> None:
    count = 0
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
        count += 1
    ctx.summary.created["tests"] = count


def _restore_files(ctx: _RestoreContext, zf: zipfile.ZipFile) -> dict[uuid.UUID, StoredFile]:
    files_by_id = {}
    for row in _read_csv_rows(zf, "files_metadata.csv"):
        file_id = _uuid_or_none(row["id"])
        stored_file = StoredFile(
            id=file_id,
            organization=ctx.organization,
            original_filename=row["original_filename"],
            content_type=row["content_type"],
            size=_int_or_default(row["size"]),
            uploaded_by_id=ctx.user_id(row["uploaded_by_id"]),
            required_permission=row["required_permission"],
        )
        # The bytes live at files/<id>/<original_filename> in the archive
        # (see services._write_files) - find it by prefix rather than
        # reconstructing the exact name, in case the filename needed
        # sanitizing on write.
        prefix = f"files/{file_id}/"
        matches = [n for n in zf.namelist() if n.startswith(prefix)]
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
    count = 0
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
        count += 1
    ctx.summary.created["documents"] = count


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
        articles_by_id[article.id] = article
    ctx.summary.created["articles"] = len(articles_by_id)
    return articles_by_id


def _restore_article_revisions(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "article_revisions.csv"):
        ArticleRevision.objects.create(
            id=_uuid_or_none(row["id"]),
            article_id=_uuid_or_none(row["article_id"]),
            title=row["title"],
            content=row["content"],
            edited_by_id=ctx.user_id(row["edited_by_id"]),
        )
        count += 1
    ctx.summary.created["article_revisions"] = count


def _restore_questions(ctx, zf, tags_by_id) -> dict[uuid.UUID, Question]:
    questions_by_id = {}
    for row in _read_csv_rows(zf, "questions.csv"):
        # accepted_answer/promoted_to_article aren't in the export (both are
        # derived/secondary state, not source content) - left unset here,
        # same as the export that produced this archive never captured them.
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
        questions_by_id[question.id] = question
    ctx.summary.created["questions"] = len(questions_by_id)
    return questions_by_id


def _restore_answers(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "answers.csv"):
        Answer.objects.create(
            id=_uuid_or_none(row["id"]),
            question_id=_uuid_or_none(row["question_id"]),
            body=row["body"],
            author_id=ctx.user_id(row["author_id"]),
        )
        count += 1
    ctx.summary.created["answers"] = count


def _restore_relations(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "knowledge_relations.csv"):
        KnowledgeRelation.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            source_content_type=ctx.content_type_for(row["source_type"]),
            source_object_id=_uuid_or_none(row["source_object_id"]),
            target_content_type=ctx.content_type_for(row["target_type"]),
            target_object_id=_uuid_or_none(row["target_object_id"]),
            relation_type=row["relation_type"],
            created_by_id=ctx.user_id(row["created_by_id"]),
        )
        count += 1
    ctx.summary.created["knowledge_relations"] = count


def _restore_grants(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "restricted_access_grants.csv"):
        granted_user_id = ctx.user_id(row["granted_user_id"])
        if granted_user_id is None:
            # Meaningless without a grantee - a grant naming nobody is just
            # noise, unlike an author/creator FK, which is fine as null.
            continue
        RestrictedAccessGrant.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            content_type=ctx.content_type_for(row["content_type"]),
            object_id=_uuid_or_none(row["object_id"]),
            granted_user_id=granted_user_id,
            granted_by_id=ctx.user_id(row["granted_by_id"]),
        )
        count += 1
    ctx.summary.created["restricted_access_grants"] = count


def _restore_bookmarks(ctx, zf) -> None:
    count = 0
    for row in _read_csv_rows(zf, "bookmarks.csv"):
        user_id = ctx.user_id(row["user_id"])
        if user_id is None:
            continue
        Bookmark.objects.create(
            id=_uuid_or_none(row["id"]),
            organization=ctx.organization,
            content_type=ctx.content_type_for(row["content_type"]),
            object_id=_uuid_or_none(row["object_id"]),
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
        if lesson is None:
            continue
        LessonKnowledgeReference.objects.create(
            id=_uuid_or_none(row["id"]),
            lesson=lesson,
            content_type=ctx.content_type_for(row["content_type"]),
            object_id=_uuid_or_none(row["object_id"]),
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


def _restore_attachments(ctx, zf, model, filename: str, parent_field: str, files_by_id) -> None:
    count = 0
    for row in _read_csv_rows(zf, filename):
        file_obj = files_by_id.get(_uuid_or_none(row["file_id"]))
        if file_obj is None:
            continue
        model.objects.create(
            id=_uuid_or_none(row["id"]),
            uploaded_by_id=ctx.user_id(row["uploaded_by_id"]),
            file=file_obj,
            **{parent_field + "_id": _uuid_or_none(row[f"{parent_field}_id"])},
        )
        count += 1
    ctx.summary.created[filename.removesuffix(".csv")] = count


@transaction.atomic
def restore_org_backup_archive(organization, archive_file) -> RestoreSummary:
    """`archive_file` is an open, seekable file-like object (a StoredFile's
    own FieldFile works) positioned at the start of a .zip produced by
    services.build_org_backup_archive. Everything below runs in one
    transaction - a failure partway through rolls the whole restore back
    rather than leaving the organization half-wiped."""
    summary = RestoreSummary()
    ctx = _RestoreContext(organization, summary)

    for model, org_lookup in _DELETE_SPECS:
        if model is StoredFile:
            for stored_file in StoredFile.objects.filter(organization=organization):
                if stored_file.file:
                    stored_file.file.delete(save=False)
            StoredFile.objects.filter(organization=organization).delete()
        else:
            model.objects.filter(**{org_lookup: organization}).delete()

    with zipfile.ZipFile(archive_file) as zf:
        tags_by_id = _restore_tags(ctx, zf)
        categories_by_id = _restore_categories(ctx, zf)
        projects_by_id = _restore_projects(ctx, zf, tags_by_id)
        components_by_id = _restore_components(ctx, zf, categories_by_id, tags_by_id)
        _restore_failures(ctx, zf, components_by_id, projects_by_id)
        _restore_sops(ctx, zf, categories_by_id, tags_by_id)
        _restore_tests(ctx, zf, projects_by_id, tags_by_id)
        files_by_id = _restore_files(ctx, zf)
        _restore_documents(ctx, zf, categories_by_id, tags_by_id, files_by_id)
        course_categories_by_id = _restore_course_categories(ctx, zf)
        courses_by_id = _restore_courses(ctx, zf, course_categories_by_id, files_by_id)
        modules_by_id = _restore_course_modules(ctx, zf, courses_by_id)
        lessons_by_id = _restore_lessons(ctx, zf, modules_by_id)
        _restore_learning_objectives(ctx, zf, lessons_by_id)
        _restore_course_resources(ctx, zf, lessons_by_id, files_by_id)
        _restore_lesson_knowledge_references(ctx, zf, lessons_by_id)
        enrollments_by_id = _restore_course_enrollments(ctx, zf, courses_by_id)
        _restore_lesson_progress(ctx, zf, enrollments_by_id, lessons_by_id)
        _restore_articles(ctx, zf, categories_by_id, tags_by_id)
        _restore_article_revisions(ctx, zf)
        _restore_questions(ctx, zf, tags_by_id)
        _restore_answers(ctx, zf)
        _restore_relations(ctx, zf)
        _restore_grants(ctx, zf)
        _restore_bookmarks(ctx, zf)
        _restore_attachments(ctx, zf, ArticleAttachment, "article_attachments.csv", "article", files_by_id)
        _restore_attachments(ctx, zf, QuestionAttachment, "question_attachments.csv", "question", files_by_id)
        _restore_attachments(ctx, zf, ProjectAttachment, "project_attachments.csv", "project", files_by_id)
        _restore_attachments(ctx, zf, ComponentAttachment, "component_attachments.csv", "component", files_by_id)
        _restore_attachments(ctx, zf, FailureAttachment, "failure_attachments.csv", "failure", files_by_id)
        _restore_attachments(ctx, zf, SopAttachment, "sop_attachments.csv", "sop", files_by_id)
        _restore_attachments(ctx, zf, TestAttachment, "test_attachments.csv", "test", files_by_id)

    return summary
