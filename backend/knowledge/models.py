import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from files.models import StoredFile


class Visibility(models.TextChoices):
    """Shared by Article and Question. PUBLIC and ORGANIZATION currently
    enforce identically (both just mean "anyone with article.read/
    question access") - there's no unauthenticated-facing view yet for
    PUBLIC to actually mean "even without login", and no Team model for a
    TEAM tier to mean anything. Both are real, forward-compatible values;
    RESTRICTED is the one that changes behavior today (author + reviewer/
    publisher only, even once published) - see _visible_article_or_404."""

    PUBLIC = "PUBLIC", "Public"
    ORGANIZATION = "ORGANIZATION", "Organization"
    RESTRICTED = "RESTRICTED", "Restricted"


class Category(models.Model):
    """Flat for now - no parent/tree yet (see docs/VISION.md's fuller
    taxonomy). Adding a nullable `parent` self-FK later is additive and
    doesn't require touching existing rows."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=120, unique=True)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Normalized (stripped/lowercased) in services._sync_tags before saving.
    name = models.CharField(max_length=50, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

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
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True)
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
