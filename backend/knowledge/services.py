from django.core.exceptions import PermissionDenied
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action

from .models import Answer, Article, ArticleRevision, Question, Tag


def _unique_slug(model, base: str) -> str:
    """Shared slugify-and-dedupe helper for Article. Lives here rather than
    utils.py because it queries the DB for uniqueness - a pure formatting
    helper would belong in utils.py per CONTRIBUTING.md 3.3, but this isn't
    pure."""
    slug = slugify(base)[:120] or "item"
    candidate, suffix = slug, 1
    while model.objects.filter(slug=candidate).exists():
        suffix += 1
        candidate = f"{slug}-{suffix}"
    return candidate


def _sync_tags(obj, tag_names: list[str] | None) -> None:
    """Shared by Article and Question. Normalizes (strip/lowercase/dedupe),
    get_or_creates each Tag, and sets obj.tags to the result. A None
    tag_names leaves existing tags untouched (distinct from an empty list,
    which clears them)."""
    if tag_names is None:
        return
    normalized = {name.strip().lower() for name in tag_names if name.strip()}
    tags = [Tag.objects.get_or_create(name=name)[0] for name in normalized]
    obj.tags.set(tags)


def create_article(*, actor, request=None, title, excerpt="", content="", category=None, tag_names=None) -> Article:
    article = Article.objects.create(
        title=title,
        slug=_unique_slug(Article, title),
        excerpt=excerpt,
        content=content,
        category=category,
        author=actor,
    )
    _sync_tags(article, tag_names)
    ArticleRevision.objects.create(article=article, title=article.title, content=article.content, edited_by=actor)
    log_action(actor=actor, action="article.create", target=article, request=request)
    return article


def update_article(*, article: Article, actor, request=None, **fields) -> Article:
    is_owner = actor == article.author
    can_override = actor.has_permission("article.update")
    if not (is_owner or can_override):
        raise PermissionDenied("You can only edit your own article.")
    if is_owner and not can_override and article.status not in (Article.Status.DRAFT, Article.Status.IN_REVIEW):
        raise PermissionDenied("A published article can only be edited by someone with article.update.")

    tag_names = fields.pop("tag_names", None)
    content_changed = "title" in fields or "content" in fields
    for field, value in fields.items():
        setattr(article, field, value)
    article.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(article, tag_names)

    if content_changed:
        ArticleRevision.objects.create(article=article, title=article.title, content=article.content, edited_by=actor)

    log_action(actor=actor, action="article.update", target=article, request=request)
    return article


def submit_article(*, article: Article, actor, request=None) -> Article:
    if actor != article.author:
        raise PermissionDenied("Only the author can submit their own draft for review.")
    if article.status != Article.Status.DRAFT:
        raise ValidationError("Only draft articles can be submitted for review.")
    article.status = Article.Status.IN_REVIEW
    article.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="article.submit", target=article, request=request)
    return article


def publish_article(*, article: Article, actor, request=None) -> Article:
    if article.status not in (Article.Status.DRAFT, Article.Status.IN_REVIEW):
        raise ValidationError("Only a draft or in-review article can be published.")
    article.status = Article.Status.PUBLISHED
    article.published_at = timezone.now()
    article.save(update_fields=["status", "published_at", "updated_at"])
    log_action(actor=actor, action="article.publish", target=article, request=request)
    return article


def delete_article(*, article: Article, actor, request=None) -> None:
    is_own_draft = actor == article.author and article.status == Article.Status.DRAFT
    if not (is_own_draft or actor.has_permission("article.delete")):
        raise PermissionDenied("You can only delete your own draft, or need article.delete.")
    log_action(
        actor=actor,
        action="article.delete",
        metadata={"article_id": str(article.pk), "title": article.title},
        request=request,
    )
    article.delete()


def create_question(*, actor, request=None, title, body="", tag_names=None) -> Question:
    question = Question.objects.create(title=title, body=body, author=actor)
    _sync_tags(question, tag_names)
    log_action(actor=actor, action="question.create", target=question, request=request)
    return question


def update_question(*, question: Question, actor, request=None, **fields) -> Question:
    if not (actor == question.author or actor.has_permission("question.moderate")):
        raise PermissionDenied("You can only edit your own question.")
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(question, field, value)
    question.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(question, tag_names)
    log_action(actor=actor, action="question.update", target=question, request=request)
    return question


def delete_question(*, question: Question, actor, request=None) -> None:
    if not (actor == question.author or actor.has_permission("question.moderate")):
        raise PermissionDenied("You can only delete your own question.")
    log_action(
        actor=actor,
        action="question.delete",
        metadata={"question_id": str(question.pk), "title": question.title},
        request=request,
    )
    question.delete()


def create_answer(*, question: Question, actor, request=None, body) -> Answer:
    answer = Answer.objects.create(question=question, author=actor, body=body)
    # Audit action string, coincidentally spelled like the "question.answer"
    # RBAC codename - a separate namespace (see audit.services.log_action),
    # not a permission check.
    log_action(actor=actor, action="question.answer", target=answer, request=request)
    return answer


def update_answer(*, answer: Answer, actor, request=None, body) -> Answer:
    if not (actor == answer.author or actor.has_permission("question.moderate")):
        raise PermissionDenied("You can only edit your own answer.")
    answer.body = body
    answer.save(update_fields=["body", "updated_at"])
    log_action(actor=actor, action="answer.update", target=answer, request=request)
    return answer


def delete_answer(*, answer: Answer, actor, request=None) -> None:
    if not (actor == answer.author or actor.has_permission("question.moderate")):
        raise PermissionDenied("You can only delete your own answer.")
    question = answer.question
    was_accepted = question.accepted_answer_id == answer.id
    log_action(actor=actor, action="answer.delete", metadata={"answer_id": str(answer.pk)}, request=request)
    answer.delete()
    if was_accepted:
        question.accepted_answer = None
        question.save(update_fields=["accepted_answer", "updated_at"])


def accept_answer(*, question: Question, actor, answer: Answer | None, request=None) -> Question:
    if not (actor == question.author or actor.has_permission("question.moderate")):
        raise PermissionDenied("Only the question's author or a moderator can accept an answer.")
    if answer is not None and answer.question_id != question.id:
        raise ValidationError("That answer does not belong to this question.")
    question.accepted_answer = answer
    question.save(update_fields=["accepted_answer", "updated_at"])
    log_action(
        actor=actor,
        action="question.accept_answer" if answer else "question.unaccept_answer",
        target=question,
        metadata={"answer_id": str(answer.pk) if answer else None},
        request=request,
    )
    return question
