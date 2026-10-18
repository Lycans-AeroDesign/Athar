import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.db.models.functions import Lower

from core.models import OrganizationScopedModel, TimeStampedModel, UUIDPrimaryKeyModel
from files.models import StoredFile

from .search import SEARCH_FIELDS, search_columns, search_indexes


class Visibility(models.TextChoices):
    """Visibility for every relatable content type. PUBLIC is org-wide (there is no
    unauthenticated or cross-org access path). RESTRICTED is visible only to the owner or
    creator, org admins, holders of the type's override permission, and users with a
    RestrictedAccessGrant; the rule lives in knowledge/visibility.py."""

    PUBLIC = "PUBLIC", "Public"
    RESTRICTED = "RESTRICTED", "Restricted"


class Category(models.Model):
    """Flat for now - no parent/tree yet (see docs/VISION.md's fuller
    taxonomy). Adding a nullable `parent` self-FK later is additive and
    doesn't require touching existing rows."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    # Credited alongside `author` and treated as owners for editing and the
    # RESTRICTED rule (see visibility.CO_OWNER_FIELD) - only the author (or an
    # article.update holder) may change who's on this list.
    co_authors = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="coauthored_articles")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)

    search_vector, search_text = search_columns(*SEARCH_FIELDS["article"])

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "status", "-updated_at"], name="kn_article_org_status"),
            *search_indexes("kn_article"),
        ]
        # slug was globally unique - now per-org.
        unique_together = [("organization", "slug")]

    def __str__(self):
        return self.title


class ArticleRevision(models.Model):
    """One row per content- or title-changing save (see services.update_article): a full
    snapshot, not a diff."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    # Same co-ownership semantics as Article.co_authors.
    co_authors = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="coauthored_questions")
    # A single nullable FK, not a boolean on Answer, so "at most one accepted answer"
    # is structural.
    accepted_answer = models.ForeignKey(
        "Answer", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Set once services.promote_question_to_article turns this question into an Article.
    promoted_to_article = models.ForeignKey(
        Article, null=True, blank=True, on_delete=models.SET_NULL, related_name="promoted_from_questions"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    search_vector, search_text = search_columns(*SEARCH_FIELDS["question"])

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="kn_question_org_created"),
            *search_indexes("kn_question"),
        ]

    def __str__(self):
        return self.title


class Answer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    """Generic source -> target link, using the same GenericForeignKey pattern as
    audit.models.AuditLog. The allowed content types are enforced in
    services.create_relation(), since ContentType can't express an allowlist."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    # References source/target generically, so it needs its own organization FK.
    # services.create_relation enforces that source, target and actor share the org.
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
    """Persists the association between an article and a file uploaded earlier through
    files.FileUploadView (same two-phase pattern as OrganizationSettings.logo_id)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
# No draft/review workflow (unlike Article/Question); CRUD permissions are the only
# gate. Each has a `visibility` field (see Visibility). services._RELATABLE_MODELS is
# the only place that needs to know these models plug into the relation graph.


class Project(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        ON_HOLD = "ON_HOLD", "On Hold"
        COMPLETED = "COMPLETED", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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

    search_vector, search_text = search_columns(*SEARCH_FIELDS["project"])

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "-updated_at"], name="kn_project_org_updated"),
            *search_indexes("kn_project"),
        ]

    def __str__(self):
        return self.name


class ComponentCategory(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Components' own category list, deliberately separate from Category so workshop
    inventory categories don't show up in an Article's category picker."""

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "component categories"
        unique_together = [("organization", "name"), ("organization", "slug")]

    def __str__(self):
        return self.name


class StorageLocation(UUIDPrimaryKeyModel, OrganizationScopedModel, TimeStampedModel):
    """Where a component physically lives in the workshop (the inventory sheet's "Grid
    Location"). A managed list rather than free text so each place has one spelling and
    the list page can filter by it. Flat: a "Box -> Shelf" path is part of the name."""

    name = models.CharField(max_length=150)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                models.F("organization"), Lower("name"), name="unique_storage_location_name_ci"
            )
        ]

    def __str__(self):
        return self.name


class Component(models.Model):
    class Status(models.TextChoices):
        CERTIFIED = "CERTIFIED", "Certified"
        TESTING = "TESTING", "Testing"
        DEPRECATED = "DEPRECATED", "Deprecated"

    class InventoryType(models.TextChoices):
        """The inventory sheet's two tabs."""

        MECHANICAL = "MECHANICAL", "Mechanical"
        ELECTRICAL = "ELECTRICAL", "Electrical"

    class Condition(models.TextChoices):
        NEW = "NEW", "New"
        GOOD = "GOOD", "Good"
        FAIR = "FAIR", "Fair"
        WORN = "WORN", "Worn"
        NEEDS_REPAIR = "NEEDS_REPAIR", "Needs Repair"
        BROKEN = "BROKEN", "Broken"

    class StockStatus(models.TextChoices):
        """Labels match the inventory sheet's Status dropdown so an export pastes back cleanly.
        IN_STOCK/LOW_STOCK/MISSING follow the quantity unless set explicitly (see
        services.derive_stock_status); ON_ORDER/RETIRED are only ever set by a person."""

        IN_STOCK = "IN_STOCK", "In Stock"
        LOW_STOCK = "LOW_STOCK", "Low Stock"
        MISSING = "MISSING", "Missing / Need to Order"
        ON_ORDER = "ON_ORDER", "On Order"
        RETIRED = "RETIRED", "Retired / Broken"

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    name = models.CharField(max_length=200)
    category = models.ForeignKey(
        ComponentCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="components"
    )
    # One representative image, distinct from ComponentAttachment's gallery; same
    # upload-then-attach pattern as accounts.User.profile_picture.
    photo = models.ForeignKey(StoredFile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    manufacturer = models.CharField(max_length=150, blank=True)
    part_number = models.CharField(max_length=100, blank=True)
    # External reference - a datasheet, vendor/purchase page, etc.
    link = models.URLField(blank=True)
    # Workshop inventory count on hand: a plain int, not a check-in/check-out ledger.
    quantity_available = models.PositiveIntegerField(default=0)
    # Engineering status. Blank = not applicable, e.g. a workshop tool
    # imported from the inventory sheet, where "Testing" would be meaningless.
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TESTING, blank=True)
    # --- Workshop inventory (mirrors the inventory sheet's columns) ---
    inventory_type = models.CharField(max_length=20, choices=InventoryType.choices, blank=True)
    location = models.ForeignKey(
        StorageLocation, null=True, blank=True, on_delete=models.SET_NULL, related_name="components"
    )
    # Free text (each/pair/set/box/ft/...) - the sheet's own Units list is
    # team-extendable, so a fixed choice set would reject new units.
    unit = models.CharField(max_length=30, blank=True)
    condition = models.CharField(max_length=20, choices=Condition.choices, blank=True)
    # Blank = inventory not tracked for this component (every component that
    # predates these fields) - see services.derive_stock_status.
    stock_status = models.CharField(max_length=20, choices=StockStatus.choices, blank=True)
    min_quantity = models.PositiveIntegerField(null=True, blank=True)
    inventory_notes = models.TextField(blank=True)
    summary = models.TextField(blank=True)  # markdown source
    # Ordered [{"label": "Processor", "value": "STM32H753..."}, ...]; spec keys vary by
    # category, so a flexible list beats fixed columns.
    specifications = models.JSONField(default=list, blank=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="components")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_components"
    )
    # The sheet's "Updated By" column - who last changed this component, by
    # any path (editor or CSV import).
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    search_vector, search_text = search_columns(*SEARCH_FIELDS["component"])

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "-updated_at"], name="kn_component_org_updated"),
            models.Index(fields=["organization", "status"], name="kn_component_org_status"),
            *search_indexes("kn_component"),
        ]

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

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    # All markdown source. Symptoms/Evidence/Investigation are folded into `summary`
    # as one narrative section.
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

    search_vector, search_text = search_columns(*SEARCH_FIELDS["failure"])

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["organization", "-date", "-created_at"], name="kn_failure_org_date"),
            *search_indexes("kn_failure"),
        ]

    def __str__(self):
        return self.title


class Sop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="sops")
    mandatory = models.BooleanField(default=False)
    # Rendered as a distinct warning callout, apart from the flowing body.
    safety_notes = models.TextField(blank=True)
    # Purpose/Prerequisites/Equipment/Procedure/etc. collapse into one markdown body,
    # same shape as Article.content.
    content = models.TextField(blank=True)  # markdown source
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="sops")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_sops"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    search_vector, search_text = search_columns(*SEARCH_FIELDS["sop"])

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "-updated_at"], name="kn_sop_org_updated"),
            *search_indexes("kn_sop"),
        ]
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

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    test_type = models.CharField(max_length=20, choices=TestType.choices, default=TestType.OTHER)
    date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=150, blank=True)
    # Direct FK (like Failure.project) since Project is a Test's central relationship.
    # Components go through the generic KnowledgeRelation graph (TESTED_IN/TESTS)
    # because a test typically involves several.
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="tests")
    objective = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    # All markdown source. Aircraft/System, Software/Firmware and Test conditions
    # collapse into `configuration`.
    configuration = models.TextField(blank=True)
    procedure = models.TextField(blank=True)
    results = models.TextField(blank=True)
    # Kept structured (not folded into `results`) - useful for filtering
    # "show me every failed test" the way Failure.severity is, unlike the
    # free-text fields around it.
    pass_fail = models.CharField(max_length=20, choices=PassFail.choices, blank=True)
    # Conclusion/Recommendations/Lessons-Learned fold into one field.
    conclusion = models.TextField(blank=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC)
    tags = models.ManyToManyField(Tag, blank=True, related_name="tests")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_tests"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    search_vector, search_text = search_columns(*SEARCH_FIELDS["test"])

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["organization", "-date", "-created_at"], name="kn_test_org_date"),
            *search_indexes("kn_test"),
        ]

    def __str__(self):
        return self.title


class Document(models.Model):
    """A relatable type with `visibility`: a single primary `file` or `url`, not a list of
    attachments. RESTRICTED rules mirror Article/Question but without a draft/review
    workflow: visible unless RESTRICTED, or you're created_by, or you hold
    document.update."""

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

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    organization = models.ForeignKey("organization.Organization", on_delete=models.CASCADE, related_name="+")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    doc_type = models.CharField(max_length=20, choices=DocType.choices, default=DocType.OTHER)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.INTERNAL)
    # External author/org name (e.g. "SAE International"); distinct from created_by
    # and from the tenant `organization` FK above.
    author = models.CharField(max_length=200, blank=True)
    external_organization = models.CharField(max_length=200, blank=True)
    publication_date = models.DateField(null=True, blank=True)
    # For references with no file of their own; a document with neither `file` nor
    # `url` is an allowed title-only stub.
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

    search_vector, search_text = search_columns(*SEARCH_FIELDS["document"])

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["organization", "-updated_at"], name="kn_document_org_updated"),
            *search_indexes("kn_document"),
        ]

    def __str__(self):
        return self.title


class ProjectAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
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
    """Lets a specific user see one RESTRICTED item, on top of its owner and whoever
    already qualifies via knowledge.visibility. Generic content_type/object_id like
    KnowledgeRelation, with its own organization FK. Uses core.models' shared base
    classes (CONTRIBUTING.md 3.4)."""

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
    """A user's personal "save for later" on any relatable content type. Generic
    content_type/object_id like KnowledgeRelation. services.bookmarks_for() drops a
    bookmark once its target becomes inaccessible to the viewer."""

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
