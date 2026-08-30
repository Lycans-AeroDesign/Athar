from django.core.exceptions import PermissionDenied
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action

from .models import Answer, Article, ArticleRevision, Category, Question, Tag


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


def _require_owner_or_permission(*, actor, owner, codename: str, message: str) -> None:
    """Shared "it's your own content, or you hold this override permission"
    guard - repeated identically across update/delete/accept/close/reopen for
    Question and Answer before being pulled out here."""
    if not (actor == owner or actor.has_permission(codename)):
        raise PermissionDenied(message)


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


def create_category(*, actor, request=None, name, description="") -> Category:
    category = Category.objects.create(
        name=name, slug=_unique_slug(Category, name), description=description
    )
    log_action(actor=actor, action="category.create", target=category, request=request)
    return category


def update_category(*, category: Category, actor, request=None, **fields) -> Category:
    for field, value in fields.items():
        setattr(category, field, value)
    category.save(update_fields=[*fields.keys()])
    log_action(actor=actor, action="category.update", target=category, request=request)
    return category


def delete_category(*, category: Category, actor, request=None) -> None:
    # Category.on_delete=SET_NULL on Article.category, so this just leaves
    # affected articles uncategorized rather than deleting them.
    log_action(
        actor=actor,
        action="category.delete",
        metadata={"category_id": str(category.pk), "name": category.name},
        request=request,
    )
    category.delete()


def create_tag(*, actor, request=None, name) -> Tag:
    normalized = name.strip().lower()
    tag, created = Tag.objects.get_or_create(name=normalized)
    if created:
        log_action(actor=actor, action="tag.create", target=tag, request=request)
    return tag


def delete_tag(*, tag: Tag, actor, request=None) -> None:
    log_action(actor=actor, action="tag.delete", metadata={"tag_id": str(tag.pk), "name": tag.name}, request=request)
    tag.delete()


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
    editable_by_owner = (Article.Status.DRAFT, Article.Status.IN_REVIEW, Article.Status.REJECTED)
    if is_owner and not can_override and article.status not in editable_by_owner:
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
    if article.status not in (Article.Status.DRAFT, Article.Status.REJECTED):
        raise ValidationError("Only a draft or rejected article can be submitted for review.")
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


def reject_article(*, article: Article, actor, request=None, reason: str = "") -> Article:
    if article.status != Article.Status.IN_REVIEW:
        raise ValidationError("Only an in-review article can be rejected.")
    article.status = Article.Status.REJECTED
    article.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="article.reject", target=article, metadata={"reason": reason}, request=request)
    return article


def archive_article(*, article: Article, actor, request=None) -> Article:
    if article.status != Article.Status.PUBLISHED:
        raise ValidationError("Only a published article can be archived.")
    article.status = Article.Status.ARCHIVED
    article.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="article.archive", target=article, request=request)
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
    _require_owner_or_permission(
        actor=actor, owner=question.author, codename="question.moderate", message="You can only edit your own question."
    )
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(question, field, value)
    question.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(question, tag_names)
    log_action(actor=actor, action="question.update", target=question, request=request)
    return question


def delete_question(*, question: Question, actor, request=None) -> None:
    _require_owner_or_permission(
        actor=actor,
        owner=question.author,
        codename="question.moderate",
        message="You can only delete your own question.",
    )
    log_action(
        actor=actor,
        action="question.delete",
        metadata={"question_id": str(question.pk), "title": question.title},
        request=request,
    )
    question.delete()


def _recomputed_open_status(question: Question) -> str:
    """What question.status should be when it's not explicitly CLOSED -
    SOLVED if an answer is accepted, else ANSWERED/OPEN depending on whether
    any answer exists. Shared by create_answer, delete_answer, accept_answer,
    and reopen_question so the four ways status can change stay consistent."""
    if question.accepted_answer_id:
        return Question.Status.SOLVED
    if question.answers.exists():
        return Question.Status.ANSWERED
    return Question.Status.OPEN


def create_answer(*, question: Question, actor, request=None, body) -> Answer:
    if question.status == Question.Status.CLOSED:
        raise ValidationError("This question is closed to new answers.")
    answer = Answer.objects.create(question=question, author=actor, body=body)
    if question.status == Question.Status.OPEN:
        question.status = Question.Status.ANSWERED
        question.save(update_fields=["status", "updated_at"])
    # Audit action string, coincidentally spelled like the "question.answer"
    # RBAC codename - a separate namespace (see audit.services.log_action),
    # not a permission check.
    log_action(actor=actor, action="question.answer", target=answer, request=request)
    return answer


def update_answer(*, answer: Answer, actor, request=None, body) -> Answer:
    _require_owner_or_permission(
        actor=actor, owner=answer.author, codename="question.moderate", message="You can only edit your own answer."
    )
    answer.body = body
    answer.save(update_fields=["body", "updated_at"])
    log_action(actor=actor, action="answer.update", target=answer, request=request)
    return answer


def delete_answer(*, answer: Answer, actor, request=None) -> None:
    _require_owner_or_permission(
        actor=actor, owner=answer.author, codename="question.moderate", message="You can only delete your own answer."
    )
    question = answer.question
    was_accepted = question.accepted_answer_id == answer.id
    log_action(actor=actor, action="answer.delete", metadata={"answer_id": str(answer.pk)}, request=request)
    answer.delete()
    if was_accepted:
        question.accepted_answer = None
    new_status = (
        question.status if question.status == Question.Status.CLOSED else _recomputed_open_status(question)
    )
    if was_accepted or new_status != question.status:
        question.status = new_status
        question.save(update_fields=["accepted_answer", "status", "updated_at"])


def accept_answer(*, question: Question, actor, answer: Answer | None, request=None) -> Question:
    _require_owner_or_permission(
        actor=actor,
        owner=question.author,
        codename="question.moderate",
        message="Only the question's author or a moderator can accept an answer.",
    )
    if answer is not None and answer.question_id != question.id:
        raise ValidationError("That answer does not belong to this question.")
    question.accepted_answer = answer
    if question.status != Question.Status.CLOSED:
        question.status = _recomputed_open_status(question)
    question.save(update_fields=["accepted_answer", "status", "updated_at"])
    log_action(
        actor=actor,
        action="question.accept_answer" if answer else "question.unaccept_answer",
        target=question,
        metadata={"answer_id": str(answer.pk) if answer else None},
        request=request,
    )
    return question


def close_question(*, question: Question, actor, request=None) -> Question:
    _require_owner_or_permission(
        actor=actor,
        owner=question.author,
        codename="question.moderate",
        message="You can only close your own question, or need question.moderate.",
    )
    if question.status == Question.Status.CLOSED:
        raise ValidationError("This question is already closed.")
    question.status = Question.Status.CLOSED
    question.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="question.close", target=question, request=request)
    return question


def reopen_question(*, question: Question, actor, request=None) -> Question:
    _require_owner_or_permission(
        actor=actor,
        owner=question.author,
        codename="question.moderate",
        message="You can only reopen your own question, or need question.moderate.",
    )
    if question.status != Question.Status.CLOSED:
        raise ValidationError("Only a closed question can be reopened.")
    question.status = _recomputed_open_status(question)
    question.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="question.reopen", target=question, request=request)
    return question


def promote_question_to_article(*, question: Question, actor, request=None) -> Article:
    if question.promoted_to_article_id:
        raise ValidationError("This question has already been promoted to an article.")
    if not question.accepted_answer_id:
        raise ValidationError("Only a question with an accepted answer can be promoted to an article.")
    accepted = question.accepted_answer
    content = f"{question.body}\n\n---\n\n**Accepted answer:**\n\n{accepted.body}"
    article = Article.objects.create(
        title=question.title, slug=_unique_slug(Article, question.title), content=content, author=actor
    )
    article.tags.set(question.tags.all())
    ArticleRevision.objects.create(article=article, title=article.title, content=article.content, edited_by=actor)
    question.promoted_to_article = article
    question.save(update_fields=["promoted_to_article", "updated_at"])
    log_action(
        actor=actor,
        action="question.promote",
        target=question,
        metadata={"article_id": str(article.pk)},
        request=request,
    )
    return article
