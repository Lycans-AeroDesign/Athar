from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.db.models import Q

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel
from files.models import StoredFile
from knowledge.models import Visibility
from knowledge.search import search_columns, search_indexes

# Registered into knowledge.search.SEARCH_FIELDS by apps.py's ready() - kept
# here so Course's generated search columns and that registry entry can't
# drift apart.
COURSE_SEARCH_FIELDS = ("title", ("short_description", "description"))


class CourseCategory(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Parallel to (deliberately not shared with) knowledge.models.Category -
    sharing one model would let a training category leak into an Article's
    category picker, which contradicts Training staying conceptually
    separate from Knowledge (see the Training Center plan's §2.1)."""

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "course categories"
        unique_together = [("organization", "name"), ("organization", "slug")]

    def __str__(self):
        return self.name


class Course(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Top-level learning unit. Status mirrors knowledge.models.Article.Status (including
    REJECTED, so a rejected course keeps its reviewer feedback trail); the transition functions
    in training.services follow knowledge.services' shape.

    Access combines `visibility` (PUBLIC/RESTRICTED, see training/visibility.py) with `status`:
    PUBLISHED = visible org-wide, DRAFT/IN_REVIEW/REJECTED = author + managers, ARCHIVED =
    hidden from discovery but still reachable by enrollees/managers."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        IN_REVIEW = "IN_REVIEW", "In Review"
        PUBLISHED = "PUBLISHED", "Published"
        REJECTED = "REJECTED", "Rejected"
        ARCHIVED = "ARCHIVED", "Archived"

    class Difficulty(models.TextChoices):
        BEGINNER = "BEGINNER", "Beginner"
        INTERMEDIATE = "INTERMEDIATE", "Intermediate"
        ADVANCED = "ADVANCED", "Advanced"

    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220)
    short_description = models.CharField(max_length=300, blank=True)
    description = models.TextField(blank=True)  # markdown source, same flat-field precedent as Article.content/Sop.content
    cover_image = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    category = models.ForeignKey(
        CourseCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="courses"
    )
    difficulty = models.CharField(max_length=20, choices=Difficulty.choices, default=Difficulty.BEGINNER)
    # Denormalized sum of module/lesson estimated_minutes, recomputed by
    # training.services._recompute_course_duration whenever a module/lesson
    # is created/updated/deleted/reordered - not user-editable directly, and
    # avoids an expensive aggregate query on every course-list render.
    estimated_minutes = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    # Same PUBLIC/RESTRICTED axis as knowledge types, orthogonal to `status`: a RESTRICTED
    # course is visible only to its author, org admins, training managers and users with a
    # RestrictedAccessGrant, whatever its status (training/visibility.py).
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    # SET_NULL, not CASCADE - deleting a user must not delete their content
    # (matches knowledge.models.Article.author's precedent).
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="authored_courses"
    )
    co_authors = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="coauthored_courses"
    )
    published_at = models.DateTimeField(null=True, blank=True)

    search_vector, search_text = search_columns(*COURSE_SEARCH_FIELDS)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "status", "-updated_at"], name="tr_course_org_status"),
            *search_indexes("tr_course"),
        ]
        unique_together = [("organization", "slug")]

    def __str__(self):
        return self.title


class CourseModule(UUIDPrimaryKeyModel, TimeStampedModel):
    """No `organization` FK - reached only through `course` (already scoped),
    same precedent as knowledge.models.ArticleRevision/Answer (see
    core.models.OrganizationScopedModel's own docstring)."""

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="modules")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField()
    estimated_minutes = models.PositiveIntegerField(default=0, blank=True)

    class Meta:
        ordering = ["order"]
        unique_together = [("course", "order")]

    def __str__(self):
        return f"{self.course_id}: {self.title}"


class Lesson(UUIDPrimaryKeyModel, TimeStampedModel):
    """Smallest learning unit. `lesson_type` is a plain TextChoices - adding
    a future type is a new enum value plus one new frontend renderer
    component, no schema change (per the spec's extensibility requirement)."""

    class LessonType(models.TextChoices):
        TEXT = "TEXT", "Text"
        VIDEO = "VIDEO", "Video"
        DOCUMENT = "DOCUMENT", "Document"
        EXTERNAL = "EXTERNAL", "External Link"
        EXERCISE = "EXERCISE", "Exercise"

    module = models.ForeignKey(CourseModule, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=200)
    short_description = models.CharField(max_length=300, blank=True)
    lesson_type = models.CharField(max_length=20, choices=LessonType.choices, default=LessonType.TEXT)
    # Markdown: primary content (TEXT), problem/expected-outcome/submission-
    # requirements collapsed into one field (EXERCISE - same "one narrative
    # field" precedent as knowledge.models.Sop.content), or supplementary
    # notes below the embed/link (VIDEO/DOCUMENT/EXTERNAL).
    content = models.TextField(blank=True)
    order = models.PositiveIntegerField()
    estimated_minutes = models.PositiveIntegerField(default=0, blank=True)
    is_required = models.BooleanField(default=True)

    class Meta:
        ordering = ["order"]
        unique_together = [("module", "order")]

    def __str__(self):
        return self.title


class LearningObjective(UUIDPrimaryKeyModel, TimeStampedModel):
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="objectives")
    text = models.CharField(max_length=300)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.text


class CourseResource(UUIDPrimaryKeyModel, TimeStampedModel):
    """A learning asset attached to a lesson: an external URL or an Athar-hosted
    StoredFile. Never a pointer into the Knowledge DB (see LessonKnowledgeReference).

    `is_primary` marks the lesson's main content, as opposed to supplementary links.

    Invariants (url XOR stored_file; provider blank unless EXTERNAL_LINK) are enforced in
    training.services.create_resource/update_resource, not as DB CheckConstraints."""

    class ResourceType(models.TextChoices):
        EXTERNAL_LINK = "EXTERNAL_LINK", "External Link"
        STORED_FILE = "STORED_FILE", "Athar File"

    class Provider(models.TextChoices):
        GOOGLE_DRIVE = "GOOGLE_DRIVE", "Google Drive"
        YOUTUBE = "YOUTUBE", "YouTube"
        VIMEO = "VIMEO", "Vimeo"
        GITHUB = "GITHUB", "GitHub"
        WEBSITE = "WEBSITE", "Website"
        OTHER = "OTHER", "Other"

    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="resources")
    title = models.CharField(max_length=200)
    description = models.CharField(max_length=300, blank=True)
    resource_type = models.CharField(max_length=20, choices=ResourceType.choices)
    provider = models.CharField(max_length=20, choices=Provider.choices, blank=True)
    url = models.URLField(max_length=2000, blank=True)
    stored_file = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_primary = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["lesson"], condition=Q(is_primary=True), name="unique_primary_course_resource_per_lesson"
            )
        ]

    def __str__(self):
        return self.title


class LessonKnowledgeReference(UUIDPrimaryKeyModel, TimeStampedModel):
    """A one-way pointer from a Lesson to a Knowledge object (Article, Question, Project,
    Component, Failure, Sop, Test, Document).

    Its own model rather than a KnowledgeRelation row, so knowledge never imports
    training.models and the training->knowledge dependency stays one-way. The allowlist of
    referenceable types lives in training.services.

    At read time, references are filtered through knowledge.visibility.can_view_instance;
    restricted-and-inaccessible or deleted (dangling GenericFK) targets are silently
    omitted, never a 403."""

    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="knowledge_references")
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name="+")
    object_id = models.UUIDField()
    target = GenericForeignKey("content_type", "object_id")
    note = models.CharField(max_length=300, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["order"]
        indexes = [models.Index(fields=["content_type", "object_id"])]
        constraints = [
            models.UniqueConstraint(
                fields=["lesson", "content_type", "object_id"], name="unique_lesson_knowledge_reference"
            )
        ]

    def __str__(self):
        return f"{self.lesson_id} -> {self.target}"


class CourseEnrollment(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Carries its own `organization` FK (unlike CourseModule/Lesson) so /my-courses/ and
    org-wide stats filter without a join; training.services.enroll_in_course validates
    it matches the course's organization.

    NOT_STARTED is implicit (no row yet).

    Deletion safety: delete_course rejects courses with enrollments, so only
    archive_course is available once a learner enrolls. That, not the on_delete choice
    below, protects enrollment/progress history."""

    class Status(models.TextChoices):
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        COMPLETED = "COMPLETED", "Completed"

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="enrollments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="course_enrollments")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-enrolled_at"]
        indexes = [
            models.Index(fields=["user", "status"], name="tr_enrollment_user_status"),
        ]
        unique_together = [("course", "user")]

    def __str__(self):
        return f"{self.user_id} enrolled in {self.course_id}"


class LessonProgress(UUIDPrimaryKeyModel):
    """Row existence means COMPLETED; nothing else is stored. mark_lesson_complete is a
    get_or_create, so duplicate completions are idempotent. No `organization` FK: reached
    only via `enrollment`, which is already org-scoped."""

    enrollment = models.ForeignKey(CourseEnrollment, on_delete=models.CASCADE, related_name="lesson_progress")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="+")
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("enrollment", "lesson")]

    def __str__(self):
        return f"{self.enrollment_id}: {self.lesson_id} completed"
