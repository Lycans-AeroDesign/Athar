import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel
from files.models import StoredFile


class Visibility(models.TextChoices):
    """Every relatable content type's visibility field (Article, Question,
    Document, and the engineering-domain types below). Two states only:
    PUBLIC means org-wide (there's no unauthenticated or cross-org access
    path in this app, so "public" and "organization-wide" are the same
    thing - a prior ORGANIZATION value that duplicated PUBLIC was removed).
    RESTRICTED means only the owner/creator, an org admin (see
    knowledge.visibility.ADMIN_BYPASS_PERMISSION), a holder of the type's
    override permission, or a user with an explicit RestrictedAccessGrant
    can see it - see knowledge/visibility.py for the single shared
    implementation of this rule."""

    PUBLIC = "PUBLIC", "Public"
    RESTRICTED = "RESTRICTED", "Restricted"


class Category(models.Model):
    """Flat for now - no parent/tree yet (see docs/VISION.md's fuller
    taxonomy). Adding a nullable `parent` self-FK later is additive and
    doesn't require touching existing rows."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"
        # Was globally unique - now per-org, so two organizations can each
        # have their own "Avionics" category without colliding.
        unique_together = [("organization", "name"), ("organization", "slug")]

    def __str__(self):
        return self.name


class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    # Normalized (stripped/lowercased) in services._sync_tags before saving.
    name = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        unique_together = [("organization", "name")]

    def __str__(self):
        return self.name


class Article(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        IN_REVIEW = "IN_REVIEW", "In Review"
        PUBLISHED = "PUBLISHED", "Published"
        REJECTED = "REJECTED", "Rejected"
        ARCHIVED = "ARCHIVED", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220)
    excerpt = models.CharField(max_length=300, blank=True)
    content = models.TextField(blank=True)  # markdown source
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="articles"
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name="articles")
    # SET_NULL, not CASCADE - deleting a user must not delete their content
    # (matches files.StoredFile.uploaded_by's precedent).
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_articles",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        # slug was globally unique - now per-org.
        unique_together = [("organization", "slug")]

    def __str__(self):
        return self.title


class ArticleRevision(models.Model):
    """One row per content/title-changing save (see knowledge/services.py's
    update_article) - a full snapshot, not a diff. Written from day one since
    revision history is the one thing genuinely expensive to retrofit once
    real articles exist without it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="revisions")
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.article_id} @ {self.created_at:%Y-%m-%d %H:%M}"


class Question(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        ANSWERED = "ANSWERED", "Answered"
        SOLVED = "SOLVED", "Solved"
        CLOSED = "CLOSED", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)  # markdown source
    # Derived from accepted_answer/answers by services.py (_recomputed_open_status)
    # rather than set directly by callers, except for the explicit CLOSED transition.
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="questions")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_questions",
    )
    # A single nullable FK, not a boolean on Answer - this is what
    # *structurally* enforces "at most one accepted answer": there is no
    # schema state where two answers on the same question are both accepted.
    accepted_answer = models.ForeignKey(
        "Answer", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Set once knowledge.services.promote_question_to_article turns this
    # question into an Article - a direct FK rather than a generic relation
    # table, since nothing else in the app has relationships to model yet.
    promoted_to_article = models.ForeignKey(
        Article, null=True, blank=True, on_delete=models.SET_NULL, related_name="promoted_from_questions"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Answer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="answers")
    body = models.TextField(blank=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_answers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Answer to {self.question_id}"


class KnowledgeRelation(models.Model):
    """Generic "this is related to that" link, source -> target. Mirrors
    audit.models.AuditLog's GenericForeignKey pattern (the one precedent for
    this in the codebase). Only Article and Question exist as real content
    types today - services.create_relation() enforces that allowlist at the
    service layer (not here, since ContentType itself can't express it) and
    the comment there explains why. relation_type is a single free-form
    value ("RELATED") for now; distinct values (USED_IN, INVOLVED_IN, ...)
    arrive once Component/Project/Failure are real models to relate to."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Not "owned" by exactly one side (it references source/target
    # generically), so it needs its own organization FK rather than
    # inheriting scoping from a parent - see services.create_relation, which
    # additionally enforces source/target/actor all share this same org
    # (the one place a cross-org link could otherwise sneak in via a
    # guessed target UUID, since the two sides resolve independently).
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")

    source_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name="+")
    source_object_id = models.UUIDField()
    source = GenericForeignKey("source_content_type", "source_object_id")

    target_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name="+")
    target_object_id = models.UUIDField()
    target = GenericForeignKey("target_content_type", "target_object_id")

    relation_type = models.CharField(max_length=50, default="RELATED")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["source_content_type", "source_object_id"]),
            models.Index(fields=["target_content_type", "target_object_id"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "source_content_type",
                    "source_object_id",
                    "target_content_type",
                    "target_object_id",
                    "relation_type",
                ],
                name="unique_knowledge_relation",
            )
        ]

    def __str__(self):
        return f"{self.source} -> {self.relation_type} -> {self.target}"


class ArticleAttachment(models.Model):
    """The file itself is uploaded standalone first via files.FileUploadView
    (same two-phase pattern as OrganizationSettings.logo_id/favicon_id) -
    this row just persists the association. No generic ContentType design
    here since `files` has no such precedent and a per-model join table is
    simpler with only two owning models."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.article_id} <- {self.file_id}"


class QuestionAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.question_id} <- {self.file_id}"


# --- Engineering domain (Projects/Components/Failures/SOPs) ---------------
#
# No draft/review/publish workflow (unlike Article/Question) - CRUD
# permissions are still the only gate on create/update/delete. Each does
# carry a `visibility` field though (see Visibility's docstring above):
# PUBLIC (default, org-wide) or RESTRICTED (owner/creator, org admin, an
# `<type>.update` holder, or an explicit RestrictedAccessGrant). See
# docs/VISION.md #13-16 for the field lists these are drawn from, and
# KnowledgeRelation's docstring above for how these plug into the existing
# generic relation graph (services._RELATABLE_MODELS is the only place that
# needs to know these models exist).


class Project(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        ON_HOLD = "ON_HOLD", "On Hold"
        COMPLETED = "COMPLETED", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)  # markdown source
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="projects")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_projects"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name


class Component(models.Model):
    class Status(models.TextChoices):
        CERTIFIED = "CERTIFIED", "Certified"
        TESTING = "TESTING", "Testing"
        DEPRECATED = "DEPRECATED", "Deprecated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    name = models.CharField(max_length=200)
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="components"
    )
    # One representative image (a card thumbnail/hero shot), distinct from
    # ComponentAttachment's own file gallery below - same single-FK,
    # SET_NULL, upload-then-attach pattern as accounts.User.profile_picture.
    photo = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    manufacturer = models.CharField(max_length=150, blank=True)
    part_number = models.CharField(max_length=100, blank=True)
    # External reference - a datasheet, vendor/purchase page, etc.
    link = models.URLField(blank=True)
    # Workshop inventory count on hand - deliberately a plain int, not a
    # ledger of individual check-in/check-out events (no consumption
    # tracking exists yet); whoever edits the component just updates this
    # number directly.
    quantity_available = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TESTING)
    summary = models.TextField(blank=True)  # markdown source
    # Ordered [{"label": "Processor", "value": "STM32H753..."}, ...] - a
    # component's meaningful spec keys vary entirely by category (a flight
    # controller's "Processor"/"Weight" vs a motor's "KV Rating"/"Max
    # Thrust"), so a flexible list beats a fixed set of columns.
    specifications = models.JSONField(default=list, blank=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="components")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_components"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name


class Failure(models.Model):
    class Severity(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"

    class Status(models.TextChoices):
        UNDER_INVESTIGATION = "UNDER_INVESTIGATION", "Under Investigation"
        RESOLVED = "RESOLVED", "Resolved"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    component = models.ForeignKey(
        Component, null=True, blank=True, on_delete=models.SET_NULL, related_name="failures"
    )
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="failures")
    aircraft = models.CharField(max_length=150, blank=True)
    date = models.DateField(null=True, blank=True)
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.MEDIUM)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.UNDER_INVESTIGATION)
    # All markdown source. Symptoms/Evidence/Investigation from
    # docs/VISION.md #16 are folded into `summary` - matches how the
    # athar_failure_detail mockup actually presents them, as one narrative
    # section, not three separate fields.
    summary = models.TextField(blank=True)
    root_cause = models.TextField(blank=True)
    corrective_action = models.TextField(blank=True)
    preventive_action = models.TextField(blank=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_failures"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return self.title


class Sop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="sops")
    mandatory = models.BooleanField(default=False)
    # Rendered as a distinct warning callout, not part of the flowing body -
    # the one thing docs/VISION.md #15 and the athar_sop_detail mockup both
    # treat as structurally special rather than just another section.
    safety_notes = models.TextField(blank=True)
    # Purpose/Prerequisites/Required Equipment/Procedure/Verification/Common
    # Mistakes/Troubleshooting/References (docs/VISION.md #15) collapse into
    # one markdown body here, same shape as Article.content - reuses
    # MarkdownEditor/Markdown as-is instead of nine separate structured fields.
    content = models.TextField(blank=True)  # markdown source
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="sops")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_sops"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "SOP"
        verbose_name_plural = "SOPs"

    def __str__(self):
        return self.title


class Test(models.Model):
    class TestType(models.TextChoices):
        FLIGHT = "FLIGHT", "Flight Test"
        THRUST = "THRUST", "Thrust Test"
        STRUCTURAL = "STRUCTURAL", "Structural Test"
        ELECTRICAL = "ELECTRICAL", "Electrical Test"
        GROUND = "GROUND", "Ground Test"
        SOFTWARE = "SOFTWARE", "Software Test"
        CALIBRATION = "CALIBRATION", "Calibration"
        EXPERIMENT = "EXPERIMENT", "Experiment"
        OTHER = "OTHER", "Other"

    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        COMPLETED = "COMPLETED", "Completed"

    class PassFail(models.TextChoices):
        PASS = "PASS", "Pass"
        FAIL = "FAIL", "Fail"
        PARTIAL = "PARTIAL", "Partial"
        NOT_APPLICABLE = "NOT_APPLICABLE", "Not Applicable"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    test_type = models.CharField(max_length=20, choices=TestType.choices, default=TestType.OTHER)
    date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=150, blank=True)
    # Direct FK (like Failure.project) since it's the most central Project
    # relationship for a Test (docs/VISION.md #15.3 lists it first) - Component
    # is deliberately NOT a direct FK here the way it is on Failure, since a
    # test typically involves several components at once; that goes through
    # the generic KnowledgeRelation graph instead (TESTED_IN/TESTS).
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="tests")
    objective = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    # All markdown source. Aircraft/System, Software/Firmware, and Test
    # conditions from docs/VISION.md #10.3's "Configuration" subsection all
    # collapse into `configuration` - same "one narrative field beats several
    # rarely-all-filled-in structured ones" precedent as Failure.summary.
    configuration = models.TextField(blank=True)
    procedure = models.TextField(blank=True)
    results = models.TextField(blank=True)
    # Kept structured (not folded into `results`) - useful for filtering
    # "show me every failed test" the way Failure.severity is, unlike the
    # free-text fields around it.
    pass_fail = models.CharField(max_length=20, choices=PassFail.choices, blank=True)
    # Conclusion/Recommendations/Lessons-Learned (docs/VISION.md #10.3) fold
    # into one field - same "lessons live inside the record" principle as
    # Failure's own docstring cites from docs/VISION.md #8.4.
    conclusion = models.TextField(blank=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="tests")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_tests"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return self.title


class Document(models.Model):
    """The one relatable type with `visibility` besides Article/Question (see
    docs/VISION.md #11.4) - a single primary `file`/`url`, not a list of
    attachments like the engineering types above (docs/VISION.md #11.5: "not
    generic file storage"). RESTRICTED enforcement mirrors Article/Question's
    (see services.visible_documents_for/_relatable_visible_to), simplified
    since there's no draft/review workflow - just "not RESTRICTED, or you're
    created_by, or you hold document.update"."""

    class DocType(models.TextChoices):
        COMPETITION_REPORT = "COMPETITION_REPORT", "Competition Report"
        TECHNICAL_REPORT = "TECHNICAL_REPORT", "Technical Report"
        RESEARCH_PAPER = "RESEARCH_PAPER", "Research Paper"
        DATASHEET = "DATASHEET", "Datasheet"
        MANUAL = "MANUAL", "Manual"
        REGULATION = "REGULATION", "Regulation"
        PRESENTATION = "PRESENTATION", "Presentation"
        TRAINING_MATERIAL = "TRAINING_MATERIAL", "Training Material"
        REFERENCE = "REFERENCE", "Reference"
        OTHER = "OTHER", "Other"

    class Source(models.TextChoices):
        INTERNAL = "INTERNAL", "Internal"
        EXTERNAL = "EXTERNAL", "External"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    doc_type = models.CharField(max_length=20, choices=DocType.choices, default=DocType.OTHER)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.INTERNAL)
    # External author/org name (e.g. "SAE International") - distinct from
    # created_by (the Athar user who added the record) AND from the
    # `organization` FK above (the tenant this Document belongs to) - renamed
    # from the field's original name `organization` once the multi-tenancy
    # retrofit needed that name for the tenant FK on every model.
    author = models.CharField(max_length=200, blank=True)
    external_organization = models.CharField(max_length=200, blank=True)
    publication_date = models.DateField(null=True, blank=True)
    # For an external reference with no file of its own (e.g. a link to a
    # competition rules page) - `file` and `url` are both optional, but a
    # document with neither is a title-only stub (allowed; not worth a
    # model-level constraint for what's ultimately a data-quality concern).
    url = models.URLField(blank=True)
    file = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    tags = models.ManyToManyField(Tag, blank=True, related_name="documents")
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_documents"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class ProjectAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.project_id} <- {self.file_id}"


class ComponentAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    component = models.ForeignKey(Component, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.component_id} <- {self.file_id}"


class FailureAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    failure = models.ForeignKey(Failure, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.failure_id} <- {self.file_id}"


class SopAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sop = models.ForeignKey(Sop, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.sop_id} <- {self.file_id}"


class TestAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name="attachments")
    file = models.ForeignKey(StoredFile, on_delete=models.CASCADE, related_name="+")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.test_id} <- {self.file_id}"


class RestrictedAccessGrant(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Names a specific user who may see one RESTRICTED item, on top of its
    owner/creator and whoever already qualifies via knowledge.visibility's
    org-admin bypass or per-type override permission. Generic content_type/
    object_id, same pattern as KnowledgeRelation (and for the same reason:
    not owned by exactly one side, needs its own organization FK). First
    knowledge model to use core.models' shared base classes - see
    CONTRIBUTING.md §3.4; existing models keep hand-rolling their own id/
    organization/timestamps rather than being retrofitted in this pass."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name="+")
    object_id = models.UUIDField()
    target = GenericForeignKey("content_type", "object_id")

    granted_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="access_grants"
    )
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["content_type", "object_id"])]
        constraints = [
            models.UniqueConstraint(
                fields=["content_type", "object_id", "granted_user"],
                name="unique_restricted_access_grant",
            )
        ]

    def __str__(self):
        return f"{self.target} granted to {self.granted_user_id}"


class Bookmark(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """A user's personal "save for later" on any relatable content type.
    Generic content_type/object_id, same pattern as KnowledgeRelation/
    RestrictedAccessGrant above. Bookmarking something you can currently see
    doesn't guarantee you'll always see it - services.bookmarks_for() drops
    a bookmark from the list once its target becomes inaccessible (e.g. it
    turns RESTRICTED and the viewer isn't granted), the same "silently omit
    the now-hidden side" precedent relations already follow."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name="+")
    object_id = models.UUIDField()
    target = GenericForeignKey("content_type", "object_id")

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["content_type", "object_id"])]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "content_type", "object_id"],
                name="unique_bookmark",
            )
        ]

    def __str__(self):
        return f"{self.user_id} bookmarked {self.target}"
