import uuid

from django.conf import settings
from django.db import models


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
