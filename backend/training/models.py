from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.db.models import Q

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel
from files.models import StoredFile


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
    """Top-level learning unit. Status mirrors knowledge.models.Article.Status
    exactly (5 states, including REJECTED) - "mirror the Knowledge article
    workflow" only holds up if REJECTED (a real terminal-but-editable state
    reached from IN_REVIEW) comes along with it; dropping it would leave a
    rejected-in-review course with nowhere to go but back to DRAFT, losing
    the reviewer's feedback trail. See knowledge.services.submit_article/
    publish_article/reject_article/archive_article/unarchive_article for the
    workflow-transition-function shape this model's own service functions
    (training.services.submit_course etc.) are structurally identical to.

    Deliberately has no `visibility` field (unlike Article/Question/the
    engineering-domain types) - gating is entirely on `status`
    (PUBLISHED = org-wide, DRAFT/IN_REVIEW/REJECTED = author + managers only,
    ARCHIVED = hidden from discovery but still reachable by existing
    enrollees/managers). A second visibility axis on top of that would be
    overengineering for what the spec actually asks for."""

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
    # SET_NULL, not CASCADE - deleting a user must not delete their content
    # (matches knowledge.models.Article.author's precedent).
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="authored_courses"
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
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
    """A learning asset attached to a lesson - either an external URL
    (Google Drive video, YouTube, GitHub repo, a website, ...) or an
    Athar-hosted StoredFile. Deliberately never a pointer into the Knowledge
    DB - see LessonKnowledgeReference below for that, and the Training
    Center plan's §1.5 for why the two are kept as disjoint models.

    `is_primary` is a plan-introduced addition beyond the spec's literal
    schema sketch: it marks which resource IS the lesson's main content (the
    video/document itself) as opposed to a supplementary "further reading"
    link/file - the spec didn't say how the lesson viewer would tell the two
    apart otherwise.

    Mutual-exclusivity invariants (url XOR stored_file; provider blank
    unless EXTERNAL_LINK) are enforced in training.services.create_resource/
    update_resource, not as DB CheckConstraints - matching how
    KnowledgeRelation's own cross-model invariants are enforced in
    knowledge/services.py, not the DB layer."""

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
    url = models.URLField(blank=True)
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
    """A one-directional pointer from a Lesson to an existing Knowledge
    object (Article/Question/Project/Component/Failure/Sop/Test/Document) -
    deliberately its OWN model, not a row in knowledge.models.KnowledgeRelation.

    KnowledgeRelation is a bidirectional *semantic* graph with a curated verb
    registry (knowledge/relationships.py's RELATIONSHIP_DEFINITIONS) - a
    Lesson->Article pointer needs no verb, and reusing it would require
    Knowledge's own _RELATABLE_MODELS allowlist to import training.models.Lesson,
    breaking the one-way training->knowledge dependency this app is built on
    (see training/apps.py's ready() for the one place training *does* reach
    into knowledge, its search-field registry - a one-time startup
    registration, not a runtime import cycle).

    Allowlist of referenceable types lives in training.services (mirroring
    knowledge.services._RELATABLE_MODELS), not here, since ContentType itself
    can't express an allowlist. Read-time behavior: a lesson's
    knowledge_references are resolved through knowledge.visibility.can_view_instance
    before being serialized - a reference whose target is RESTRICTED-and-
    inaccessible, or has since been deleted (dangling GenericFK, no DB
    constraint), is silently omitted, never a 403 - same precedent
    knowledge.models.Bookmark documents for itself."""

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
    """Unlike CourseModule/Lesson, this DOES carry its own `organization` FK
    despite being reachable via course.organization - /my-courses/ and
    org-wide stats need direct filtering without a join, and
    training.services.enroll_in_course validates
    actor.organization == course.organization at creation, the same "own FK
    despite an already-scoped parent, because this is the one place a
    cross-org mistake could otherwise sneak in" rationale
    knowledge.models.KnowledgeRelation documents for itself.

    NOT_STARTED is implicit (no enrollment row exists yet), per the spec.

    Deletion safety: training.services.delete_course rejects deletion while
    course.enrollments.exists() - hard delete is only possible for
    enrollment-free drafts; once any learner has enrolled, only
    archive_course is available. This is what actually guarantees enrollment/
    progress history is never destroyed - not the on_delete choice below."""

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
        unique_together = [("course", "user")]

    def __str__(self):
        return f"{self.user_id} enrolled in {self.course_id}"


class LessonProgress(UUIDPrimaryKeyModel):
    """Row existence = COMPLETED, nothing else stored - a deliberate
    simplification versus the spec's literal schema sketch (which has an
    explicit completed/not-completed state field). This is the same idiom
    the spec itself already uses for CourseEnrollment's implicit NOT_STARTED.
    training.services.mark_lesson_complete is get_or_create(enrollment=,
    lesson=) - inherently idempotent, satisfying "duplicate completion
    handling" for free. No `organization` FK - reached only via `enrollment`
    (already org-scoped), same precedent as CourseModule."""

    enrollment = models.ForeignKey(CourseEnrollment, on_delete=models.CASCADE, related_name="lesson_progress")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="+")
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("enrollment", "lesson")]

    def __str__(self):
        return f"{self.enrollment_id}: {self.lesson_id} completed"
