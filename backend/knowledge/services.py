import csv
import datetime
import io
import re
import uuid

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q, QuerySet
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from files.services import confirm_stored_files, confirm_stored_files_in_text

from . import relationships
from . import visibility as visibility_rules
from .scoring import ACCEPTED_ANSWER_ACTION, ACCEPTED_ANSWER_POINTS, CONTRIBUTION_POINTS

from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Bookmark,
    Category,
    Component,
    ComponentAttachment,
    ComponentCategory,
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
    StorageLocation,
    Tag,
    Test,
    TestAttachment,
    Visibility,
)


def _unique_slug(model, base: str, organization) -> str:
    """Shared slugify-and-dedupe helper for Article. Lives here rather than
    utils.py because it queries the DB for uniqueness - a pure formatting
    helper would belong in utils.py per CONTRIBUTING.md 3.3, but this isn't
    pure. Uniqueness is scoped per-organization (see Article/Category's Meta) -
    two tenants can each have a "flight-review" slug without colliding."""
    slug = slugify(base)[:120] or "item"
    candidate, suffix = slug, 1
    while model.objects.filter(organization=organization, slug=candidate).exists():
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
    """Shared across every taggable type. Normalizes (strip/lowercase/dedupe),
    get_or_creates each Tag *within obj's own organization* (see Tag's Meta -
    uniqueness is per-org, so two tenants can each have their own "motors"
    tag), and sets obj.tags to the result. A None tag_names leaves existing
    tags untouched (distinct from an empty list, which clears them)."""
    if tag_names is None:
        return
    normalized = {name.strip().lower() for name in tag_names if name.strip()}
    tags = [Tag.objects.get_or_create(organization=obj.organization, name=name)[0] for name in normalized]
    obj.tags.set(tags)


def visible_articles_for(viewer) -> QuerySet[Article]:
    """Published articles `viewer` may see - excludes RESTRICTED ones unless
    they're privileged for it (owner, org admin, or article.review/
    article.publish holder) or hold an explicit grant. Shared by
    ArticleListCreateView, SearchView, and the user-profile/contributions
    endpoints so this rule can't drift out of sync between them the way it
    already once did (see the search-visibility fix this same rule exists for)."""
    queryset = Article.objects.filter(organization=viewer.organization, status=Article.Status.PUBLISHED)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Article, "article")


def visible_questions_for(viewer) -> QuerySet[Question]:
    """Questions `viewer` may see - same rule as visible_articles_for above,
    via question.moderate as the override permission."""
    queryset = Question.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Question, "question")


def visible_documents_for(viewer) -> QuerySet[Document]:
    """Documents `viewer` may see - same rule as visible_articles_for above,
    via document.update as the override permission. Simpler than Article/
    Question since Document has no draft/review workflow - see models.py's
    Document docstring."""
    queryset = Document.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Document, "document")


def visible_projects_for(viewer) -> QuerySet[Project]:
    queryset = Project.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Project, "project")


def visible_components_for(viewer) -> QuerySet[Component]:
    queryset = Component.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Component, "component")


def visible_failures_for(viewer) -> QuerySet[Failure]:
    queryset = Failure.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Failure, "failure")


def visible_sops_for(viewer) -> QuerySet[Sop]:
    queryset = Sop.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Sop, "sop")


def visible_tests_for(viewer) -> QuerySet[Test]:
    queryset = Test.objects.filter(organization=viewer.organization)
    return visibility_rules.exclude_inaccessible(queryset, viewer, Test, "test")


def create_category(*, actor, request=None, name, description="") -> Category:
    category = Category.objects.create(
        organization=actor.organization,
        name=name,
        slug=_unique_slug(Category, name, actor.organization),
        description=description,
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
    tag, created = Tag.objects.get_or_create(organization=actor.organization, name=normalized)
    if created:
        log_action(actor=actor, action="tag.create", target=tag, request=request)
    return tag


def delete_tag(*, tag: Tag, actor, request=None) -> None:
    log_action(actor=actor, action="tag.delete", metadata={"tag_id": str(tag.pk), "name": tag.name}, request=request)
    tag.delete()


def create_article(
    *,
    actor,
    request=None,
    title,
    excerpt="",
    content="",
    category=None,
    tag_names=None,
    visibility=Visibility.PUBLIC,
) -> Article:
    article = Article.objects.create(
        organization=actor.organization,
        title=title,
        slug=_unique_slug(Article, title, actor.organization),
        excerpt=excerpt,
        content=content,
        category=category,
        author=actor,
        visibility=visibility,
    )
    _sync_tags(article, tag_names)
    ArticleRevision.objects.create(article=article, title=article.title, content=article.content, edited_by=actor)
    confirm_stored_files_in_text(content, organization=actor.organization)
    log_action(actor=actor, action="article.create", target=article, request=request)
    return article


def update_article(*, article: Article, actor, request=None, **fields) -> Article:
    is_owner = actor == article.author
    can_override = actor.has_permission("article.update")
    if not (is_owner or can_override):
        raise PermissionDenied("You can only edit your own article.")
    # Archived is a frozen state for everyone, even actor.has_permission("article.update") -
    # unarchive_article() (PUBLISHED, not editable-in-place) is the only way back to an editable state.
    if article.status == Article.Status.ARCHIVED:
        raise ValidationError("An archived article must be unarchived before it can be edited.")
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
    if "content" in fields:
        confirm_stored_files_in_text(fields["content"], organization=article.organization)

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


def unarchive_article(*, article: Article, actor, request=None) -> Article:
    """Restores an archived article to PUBLISHED - deliberately doesn't touch
    published_at, so it keeps reflecting when the article was first published
    rather than resetting to now."""
    if article.status != Article.Status.ARCHIVED:
        raise ValidationError("Only an archived article can be unarchived.")
    article.status = Article.Status.PUBLISHED
    article.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="article.unarchive", target=article, request=request)
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


def create_question(*, actor, request=None, title, body="", tag_names=None, visibility=Visibility.PUBLIC) -> Question:
    question = Question.objects.create(
        organization=actor.organization, title=title, body=body, author=actor, visibility=visibility
    )
    _sync_tags(question, tag_names)
    confirm_stored_files_in_text(body, organization=actor.organization)
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
    if "body" in fields:
        confirm_stored_files_in_text(fields["body"], organization=question.organization)
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
    confirm_stored_files_in_text(body, organization=actor.organization)
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
    confirm_stored_files_in_text(body, organization=answer.question.organization)
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
        organization=actor.organization,
        title=question.title,
        slug=_unique_slug(Article, question.title, actor.organization),
        content=content,
        author=actor,
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


# --- Engineering domain (Project/Component/Failure/Sop) -------------------
#
# No draft/review workflow on any of these (see models.py's module
# docstring) - so unlike Article/Question, there's no "owner can edit their
# own draft" case to account for. Editing/deleting is gated purely on the
# x.update/x.delete permission, full stop - matches docs/VISION.md #26's
# "Member: report failures" vs "Mentor: update failures" split
# (create and update are deliberately separate tiers, not "ownership
# unlocks editing"). They do each carry a `visibility` field though - see
# Visibility's docstring in models.py and knowledge/visibility.py for how
# RESTRICTED is enforced identically to Article/Question/Document.


def create_project(
    *, actor, request=None, name, description="", status=Project.Status.ACTIVE, tag_names=None,
    visibility=Visibility.PUBLIC,
) -> Project:
    project = Project.objects.create(
        organization=actor.organization, name=name, description=description, status=status, created_by=actor,
        visibility=visibility,
    )
    _sync_tags(project, tag_names)
    confirm_stored_files_in_text(description, organization=actor.organization)
    log_action(actor=actor, action="project.create", target=project, request=request)
    return project


def update_project(*, project: Project, actor, request=None, **fields) -> Project:
    if not actor.has_permission("project.update"):
        raise PermissionDenied("You need project.update to edit this project.")
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(project, field, value)
    project.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(project, tag_names)
    if "description" in fields:
        confirm_stored_files_in_text(fields["description"], organization=project.organization)
    log_action(actor=actor, action="project.update", target=project, request=request)
    return project


def delete_project(*, project: Project, actor, request=None) -> None:
    if not actor.has_permission("project.delete"):
        raise PermissionDenied("You need project.delete to remove this project.")
    log_action(actor=actor, action="project.delete", metadata={"project_id": str(project.pk), "name": project.name}, request=request)
    project.delete()


# --- Component categories & storage locations -------------------------------


def create_component_category(*, actor, request=None, name, description="") -> ComponentCategory:
    category = ComponentCategory.objects.create(
        organization=actor.organization,
        name=name,
        slug=_unique_slug(ComponentCategory, name, actor.organization),
        description=description,
    )
    log_action(actor=actor, action="component_category.create", target=category, request=request)
    return category


def update_component_category(*, category: ComponentCategory, actor, request=None, **fields) -> ComponentCategory:
    for field, value in fields.items():
        setattr(category, field, value)
    category.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="component_category.update", target=category, request=request)
    return category


def delete_component_category(*, category: ComponentCategory, actor, request=None) -> None:
    # SET_NULL on Component.category - its components just become uncategorized.
    log_action(
        actor=actor,
        action="component_category.delete",
        metadata={"category_id": str(category.pk), "name": category.name},
        request=request,
    )
    category.delete()


def get_or_create_component_category(name: str, *, actor, request=None) -> ComponentCategory:
    """Case-insensitive, org-scoped. Not gated on category.manage: anyone who
    can create a component can already invent new tags freely, and a CSV
    import row shouldn't fail just because its category is new."""
    name = name.strip()
    category = ComponentCategory.objects.filter(organization=actor.organization, name__iexact=name).first()
    return category or create_component_category(actor=actor, request=request, name=name)


def create_storage_location(*, actor, request=None, name, description="") -> StorageLocation:
    location = StorageLocation.objects.create(organization=actor.organization, name=name.strip(), description=description)
    log_action(actor=actor, action="storage_location.create", target=location, request=request)
    return location


def update_storage_location(*, location: StorageLocation, actor, request=None, **fields) -> StorageLocation:
    """Renaming a location to the name of another existing one merges them -
    every component moves to the existing location and this one is deleted -
    which is how a "Fuselage box" / "Fuselage Box" typo pair gets cleaned up.
    Returns whichever location survives."""
    new_name = fields.get("name", "").strip()
    if new_name:
        fields["name"] = new_name
        target = (
            StorageLocation.objects.filter(organization=location.organization, name__iexact=new_name)
            .exclude(pk=location.pk)
            .first()
        )
        if target is not None:
            Component.objects.filter(location=location).update(location=target)
            log_action(
                actor=actor,
                action="storage_location.merge",
                target=target,
                metadata={"merged_location_id": str(location.pk), "merged_name": location.name},
                request=request,
            )
            location.delete()
            return target
    for field, value in fields.items():
        setattr(location, field, value)
    location.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="storage_location.update", target=location, request=request)
    return location


def delete_storage_location(*, location: StorageLocation, actor, request=None) -> None:
    # SET_NULL on Component.location - its components just lose their place.
    log_action(
        actor=actor,
        action="storage_location.delete",
        metadata={"location_id": str(location.pk), "name": location.name},
        request=request,
    )
    location.delete()


def get_or_create_storage_location(name: str, *, actor, request=None) -> StorageLocation:
    name = name.strip()
    location = StorageLocation.objects.filter(organization=actor.organization, name__iexact=name).first()
    return location or create_storage_location(actor=actor, request=request, name=name)


def _resolve_location_name(location_name: str, *, actor, request=None) -> StorageLocation | None:
    """The write APIs take a location by name (see ComponentWriteSerializer)
    so the editor can offer "type a new place" without a separate create
    step: "" clears it, anything else is get-or-created."""
    if not location_name.strip():
        return None
    return get_or_create_storage_location(location_name, actor=actor, request=request)


# --- Components ----------------------------------------------------------------

# Stock statuses that follow the quantity automatically - ON_ORDER/RETIRED
# are a person's call and never overwritten by a quantity change. "" is a
# component whose inventory was never tracked (it predates these fields).
_AUTO_STOCK_STATUSES = {
    "",
    Component.StockStatus.IN_STOCK,
    Component.StockStatus.LOW_STOCK,
    Component.StockStatus.MISSING,
}


def derive_stock_status(quantity: int, min_quantity: int | None, current: str = "") -> str:
    """The automatic stock status for a quantity: none left is Missing;
    below the "Min. Qty Desired" threshold is Low Stock; otherwise In Stock.
    With no threshold set, a Low Stock someone chose by hand is kept (the
    inventory sheet marks things low without ever filling in a minimum)."""
    if quantity == 0:
        return Component.StockStatus.MISSING
    if min_quantity is not None:
        return Component.StockStatus.LOW_STOCK if quantity < min_quantity else Component.StockStatus.IN_STOCK
    if current == Component.StockStatus.LOW_STOCK:
        return Component.StockStatus.LOW_STOCK
    return Component.StockStatus.IN_STOCK


def create_component(
    *, actor, request=None, name, category=None, photo=None, manufacturer="", part_number="", link="",
    quantity_available=0, status=Component.Status.TESTING, summary="", specifications=None, tag_names=None,
    visibility=Visibility.PUBLIC, inventory_type="", location=None, location_name=None, unit="", condition="",
    stock_status=None, min_quantity=None, inventory_notes="",
) -> Component:
    """`stock_status` None/"" means "work it out from the quantity" - see
    derive_stock_status."""
    if location_name is not None:
        location = _resolve_location_name(location_name, actor=actor, request=request)
    component = Component.objects.create(
        organization=actor.organization,
        name=name,
        category=category,
        photo=photo,
        manufacturer=manufacturer,
        part_number=part_number,
        link=link,
        quantity_available=quantity_available,
        status=status,
        summary=summary,
        specifications=specifications or [],
        created_by=actor,
        updated_by=actor,
        visibility=visibility,
        inventory_type=inventory_type,
        location=location,
        unit=unit,
        condition=condition,
        stock_status=stock_status or derive_stock_status(quantity_available, min_quantity),
        min_quantity=min_quantity,
        inventory_notes=inventory_notes,
    )
    _sync_tags(component, tag_names)
    confirm_stored_files(photo)
    confirm_stored_files_in_text(summary, organization=actor.organization)
    log_action(actor=actor, action="component.create", target=component, request=request)
    return component


def _apply_stock_status_rule(component: Component, fields: dict) -> None:
    """Mutates `fields` in place: an explicit "" stock_status, or a quantity/
    minimum change with no stock_status given while the current one is
    automatic, gets the derived status."""
    quantity = fields.get("quantity_available", component.quantity_available)
    min_quantity = fields.get("min_quantity", component.min_quantity)
    if "stock_status" in fields:
        if not fields["stock_status"]:
            fields["stock_status"] = derive_stock_status(quantity, min_quantity, component.stock_status)
    elif ("quantity_available" in fields or "min_quantity" in fields) and component.stock_status in _AUTO_STOCK_STATUSES:
        derived = derive_stock_status(quantity, min_quantity, component.stock_status)
        if derived != component.stock_status:
            fields["stock_status"] = derived


def update_component(*, component: Component, actor, request=None, **fields) -> Component:
    if not actor.has_permission("component.update"):
        raise PermissionDenied("You need component.update to edit this component.")
    tag_names = fields.pop("tag_names", None)
    if "location_name" in fields:
        fields["location"] = _resolve_location_name(fields.pop("location_name"), actor=actor, request=request)
    _apply_stock_status_rule(component, fields)
    fields["updated_by"] = actor
    for field, value in fields.items():
        setattr(component, field, value)
    component.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(component, tag_names)
    confirm_stored_files(fields.get("photo"))
    if "summary" in fields:
        confirm_stored_files_in_text(fields["summary"], organization=component.organization)
    log_action(actor=actor, action="component.update", target=component, request=request)
    return component


def delete_component(*, component: Component, actor, request=None) -> None:
    if not actor.has_permission("component.delete"):
        raise PermissionDenied("You need component.delete to remove this component.")
    log_action(
        actor=actor, action="component.delete", metadata={"component_id": str(component.pk), "name": component.name}, request=request
    )
    component.delete()


def create_failure(
    *, actor, request=None, title, component=None, project=None, aircraft="", date=None,
    severity=Failure.Severity.MEDIUM, status=Failure.Status.UNDER_INVESTIGATION,
    summary="", root_cause="", corrective_action="", preventive_action="", visibility=Visibility.PUBLIC,
) -> Failure:
    failure = Failure.objects.create(
        organization=actor.organization,
        title=title,
        component=component,
        project=project,
        aircraft=aircraft,
        date=date,
        severity=severity,
        status=status,
        summary=summary,
        root_cause=root_cause,
        corrective_action=corrective_action,
        preventive_action=preventive_action,
        created_by=actor,
        visibility=visibility,
    )
    confirm_stored_files_in_text(summary, root_cause, corrective_action, preventive_action, organization=actor.organization)
    log_action(actor=actor, action="failure.create", target=failure, request=request)
    return failure


def update_failure(*, failure: Failure, actor, request=None, **fields) -> Failure:
    if not actor.has_permission("failure.update"):
        raise PermissionDenied("You need failure.update to edit this failure report.")
    for field, value in fields.items():
        setattr(failure, field, value)
    failure.save(update_fields=[*fields.keys(), "updated_at"])
    confirm_stored_files_in_text(
        *(fields[f] for f in ("summary", "root_cause", "corrective_action", "preventive_action") if f in fields),
        organization=failure.organization,
    )
    log_action(actor=actor, action="failure.update", target=failure, request=request)
    return failure


def delete_failure(*, failure: Failure, actor, request=None) -> None:
    if not actor.has_permission("failure.delete"):
        raise PermissionDenied("You need failure.delete to remove this failure report.")
    log_action(actor=actor, action="failure.delete", metadata={"failure_id": str(failure.pk), "title": failure.title}, request=request)
    failure.delete()


def create_sop(
    *, actor, request=None, title, category=None, mandatory=False, safety_notes="", content="", tag_names=None,
    visibility=Visibility.PUBLIC,
) -> Sop:
    sop = Sop.objects.create(
        organization=actor.organization,
        title=title,
        category=category,
        mandatory=mandatory,
        safety_notes=safety_notes,
        content=content,
        created_by=actor,
        visibility=visibility,
    )
    _sync_tags(sop, tag_names)
    confirm_stored_files_in_text(content, organization=actor.organization)
    log_action(actor=actor, action="sop.create", target=sop, request=request)
    return sop


def update_sop(*, sop: Sop, actor, request=None, **fields) -> Sop:
    if not actor.has_permission("sop.update"):
        raise PermissionDenied("You need sop.update to edit this SOP.")
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(sop, field, value)
    sop.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(sop, tag_names)
    if "content" in fields:
        confirm_stored_files_in_text(fields["content"], organization=sop.organization)
    log_action(actor=actor, action="sop.update", target=sop, request=request)
    return sop


def delete_sop(*, sop: Sop, actor, request=None) -> None:
    if not actor.has_permission("sop.delete"):
        raise PermissionDenied("You need sop.delete to remove this SOP.")
    log_action(actor=actor, action="sop.delete", metadata={"sop_id": str(sop.pk), "title": sop.title}, request=request)
    sop.delete()


def create_test(
    *,
    actor,
    request=None,
    title,
    test_type="OTHER",
    date=None,
    location="",
    project=None,
    objective="",
    status="PLANNED",
    configuration="",
    procedure="",
    results="",
    pass_fail="",
    conclusion="",
    tag_names=None,
    visibility=Visibility.PUBLIC,
) -> Test:
    test = Test.objects.create(
        organization=actor.organization,
        title=title,
        test_type=test_type,
        date=date,
        location=location,
        project=project,
        objective=objective,
        status=status,
        configuration=configuration,
        procedure=procedure,
        results=results,
        pass_fail=pass_fail,
        conclusion=conclusion,
        created_by=actor,
        visibility=visibility,
    )
    _sync_tags(test, tag_names)
    confirm_stored_files_in_text(objective, configuration, procedure, results, conclusion, organization=actor.organization)
    log_action(actor=actor, action="test.create", target=test, request=request)
    return test


def update_test(*, test: Test, actor, request=None, **fields) -> Test:
    if not actor.has_permission("test.update"):
        raise PermissionDenied("You need test.update to edit this test.")
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(test, field, value)
    test.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(test, tag_names)
    confirm_stored_files_in_text(
        *(fields[f] for f in ("objective", "configuration", "procedure", "results", "conclusion") if f in fields),
        organization=test.organization,
    )
    log_action(actor=actor, action="test.update", target=test, request=request)
    return test


def delete_test(*, test: Test, actor, request=None) -> None:
    if not actor.has_permission("test.delete"):
        raise PermissionDenied("You need test.delete to remove this test.")
    log_action(actor=actor, action="test.delete", metadata={"test_id": str(test.pk), "title": test.title}, request=request)
    test.delete()


def create_document(
    *,
    actor,
    request=None,
    title,
    description="",
    doc_type="OTHER",
    source="INTERNAL",
    author="",
    external_organization="",
    publication_date=None,
    url="",
    file=None,
    category=None,
    tag_names=None,
    visibility=Visibility.PUBLIC,
) -> Document:
    document = Document.objects.create(
        organization=actor.organization,
        title=title,
        description=description,
        doc_type=doc_type,
        source=source,
        author=author,
        external_organization=external_organization,
        publication_date=publication_date,
        url=url,
        file=file,
        category=category,
        created_by=actor,
        visibility=visibility,
    )
    _sync_tags(document, tag_names)
    confirm_stored_files(file)
    confirm_stored_files_in_text(description, organization=actor.organization)
    log_action(actor=actor, action="document.create", target=document, request=request)
    return document


def update_document(*, document: Document, actor, request=None, **fields) -> Document:
    # Same "own it, or hold the override permission" shape as
    # update_question/delete_question - see models.py's Document docstring
    # for why this (not a tiered read/create/update/delete-only scheme) is
    # the right fit here.
    _require_owner_or_permission(
        actor=actor, owner=document.created_by, codename="document.update", message="You can only edit your own document."
    )
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(document, field, value)
    document.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(document, tag_names)
    confirm_stored_files(fields.get("file"))
    if "description" in fields:
        confirm_stored_files_in_text(fields["description"], organization=document.organization)
    log_action(actor=actor, action="document.update", target=document, request=request)
    return document


def delete_document(*, document: Document, actor, request=None) -> None:
    _require_owner_or_permission(
        actor=actor,
        owner=document.created_by,
        codename="document.update",
        message="You can only delete your own document.",
    )
    log_action(
        actor=actor, action="document.delete", metadata={"document_id": str(document.pk), "title": document.title}, request=request
    )
    document.delete()


def _add_engineering_attachment(*, owner, attachment_model, owner_field: str, file, actor, request, action: str):
    attachment = attachment_model.objects.create(**{owner_field: owner}, file=file, uploaded_by=actor)
    confirm_stored_files(file)
    log_action(
        actor=actor, action=action, target=owner, metadata={"file_id": str(file.pk), "filename": file.original_filename}, request=request
    )
    return attachment


def _remove_engineering_attachment(*, attachment, actor, request, action: str, id_field: str):
    log_action(
        actor=actor,
        action=action,
        metadata={"attachment_id": str(attachment.pk), id_field: str(getattr(attachment, id_field))},
        request=request,
    )
    attachment.delete()


def add_project_attachment(*, project: Project, file, actor, request=None) -> ProjectAttachment:
    if not actor.has_permission("project.update"):
        raise PermissionDenied("You need project.update to attach files to this project.")
    return _add_engineering_attachment(
        owner=project, attachment_model=ProjectAttachment, owner_field="project", file=file, actor=actor,
        request=request, action="attachment.add",
    )


def remove_project_attachment(*, attachment: ProjectAttachment, actor, request=None) -> None:
    if not actor.has_permission("project.update"):
        raise PermissionDenied("You need project.update to remove attachments from this project.")
    _remove_engineering_attachment(attachment=attachment, actor=actor, request=request, action="attachment.remove", id_field="project_id")


def add_component_attachment(*, component: Component, file, actor, request=None) -> ComponentAttachment:
    if not actor.has_permission("component.update"):
        raise PermissionDenied("You need component.update to attach files to this component.")
    return _add_engineering_attachment(
        owner=component, attachment_model=ComponentAttachment, owner_field="component", file=file, actor=actor,
        request=request, action="attachment.add",
    )


def remove_component_attachment(*, attachment: ComponentAttachment, actor, request=None) -> None:
    if not actor.has_permission("component.update"):
        raise PermissionDenied("You need component.update to remove attachments from this component.")
    _remove_engineering_attachment(
        attachment=attachment, actor=actor, request=request, action="attachment.remove", id_field="component_id"
    )


def add_failure_attachment(*, failure: Failure, file, actor, request=None) -> FailureAttachment:
    if not actor.has_permission("failure.update"):
        raise PermissionDenied("You need failure.update to attach files to this failure report.")
    return _add_engineering_attachment(
        owner=failure, attachment_model=FailureAttachment, owner_field="failure", file=file, actor=actor,
        request=request, action="attachment.add",
    )


def remove_failure_attachment(*, attachment: FailureAttachment, actor, request=None) -> None:
    if not actor.has_permission("failure.update"):
        raise PermissionDenied("You need failure.update to remove attachments from this failure report.")
    _remove_engineering_attachment(attachment=attachment, actor=actor, request=request, action="attachment.remove", id_field="failure_id")


def add_sop_attachment(*, sop: Sop, file, actor, request=None) -> SopAttachment:
    if not actor.has_permission("sop.update"):
        raise PermissionDenied("You need sop.update to attach files to this SOP.")
    return _add_engineering_attachment(
        owner=sop, attachment_model=SopAttachment, owner_field="sop", file=file, actor=actor,
        request=request, action="attachment.add",
    )


def remove_sop_attachment(*, attachment: SopAttachment, actor, request=None) -> None:
    if not actor.has_permission("sop.update"):
        raise PermissionDenied("You need sop.update to remove attachments from this SOP.")
    _remove_engineering_attachment(attachment=attachment, actor=actor, request=request, action="attachment.remove", id_field="sop_id")


def add_test_attachment(*, test: Test, file, actor, request=None) -> TestAttachment:
    if not actor.has_permission("test.update"):
        raise PermissionDenied("You need test.update to attach files to this test.")
    return _add_engineering_attachment(
        owner=test, attachment_model=TestAttachment, owner_field="test", file=file, actor=actor,
        request=request, action="attachment.add",
    )


def remove_test_attachment(*, attachment: TestAttachment, actor, request=None) -> None:
    if not actor.has_permission("test.update"):
        raise PermissionDenied("You need test.update to remove attachments from this test.")
    _remove_engineering_attachment(attachment=attachment, actor=actor, request=request, action="attachment.remove", id_field="test_id")


# Only Article/Question/Project/Component/Failure/Sop/Test/Document exist as
# real content types - this allowlist is what actually stops a relation
# being created to some other model (ContentType itself has no way to
# express "only these").
_RELATABLE_MODELS = {
    "article": Article,
    "question": Question,
    "project": Project,
    "component": Component,
    "failure": Failure,
    "sop": Sop,
    "test": Test,
    "document": Document,
}

# model_name -> the permission that grants edit rights on that type, for
# types with no per-item ownership concept (see the engineering-domain note
# above) - _can_edit_relatable falls back to this when the instance has no
# `author` attribute of its own to compare against.
_RELATABLE_UPDATE_PERMISSION = {
    "project": "project.update",
    "component": "component.update",
    "failure": "failure.update",
    "sop": "sop.update",
    "test": "test.update",
}


def _resolve_relatable(model_name: str, object_id, organization):
    """Org-scoped on purpose (see `organization` param) - a cross-org UUID
    guess resolves to "not found" here, the same 400 as a genuinely
    nonexistent id, rather than leaking whether the id exists in a
    different tenant."""
    model = _RELATABLE_MODELS.get(model_name)
    if model is None:
        raise ValidationError(f"'{model_name}' isn't a type that can be related yet.")
    instance = model.objects.filter(pk=object_id, organization=organization).first()
    if instance is None:
        raise ValidationError(f"No {model_name} with id {object_id}.")
    return model, instance


def _can_edit_relatable(actor, model_name: str, instance) -> bool:
    if instance is None:
        return False
    if model_name in _RELATABLE_UPDATE_PERMISSION:
        return actor.has_permission(_RELATABLE_UPDATE_PERMISSION[model_name])
    if model_name == "document":
        return actor == getattr(instance, "created_by", None) or actor.has_permission("document.update")
    codename = "article.update" if model_name == "article" else "question.moderate"
    return actor == getattr(instance, "author", None) or actor.has_permission(codename)


def create_relation(
    *, actor, request=None, source_type: str, source_id, target_type: str, target_id, relation_type="RELATED"
) -> KnowledgeRelation:
    # Both sides resolved within actor's own organization (see
    # _resolve_relatable's own docstring) - this is what actually prevents a
    # cross-org relation from ever being created, not a check after the fact.
    source_model, source = _resolve_relatable(source_type, source_id, actor.organization)
    target_model, target = _resolve_relatable(target_type, target_id, actor.organization)
    # A RESTRICTED target the actor can't see gets the exact same "not
    # found" as a nonexistent id - otherwise linking to a guessed id would
    # both confirm it exists and echo its title back in the response.
    if not visibility_rules.can_view_instance(actor, target_type, target):
        raise ValidationError(f"No {target_type} with id {target_id}.")
    if source_model is target_model and source.pk == target.pk:
        raise ValidationError("An item can't be related to itself.")

    # Checked against the caller's own source (the item they're adding this
    # relation FROM) before any canonical-direction normalization below -
    # normalizing first would check edit rights on the wrong side whenever
    # the caller picked the relation type from its reverse_name (e.g. adding
    # "USED_IN" from a Component's own page, where the canonical direction is
    # actually Project--USES-->Component).
    if not _can_edit_relatable(actor, source_type, source):
        raise PermissionDenied("You can only add related content to something you own (or have edit rights on).")

    stored_relation_type = relation_type
    store_source_model, store_source, store_target_model, store_target = source_model, source, target_model, target
    if relation_type != relationships.GENERIC_RELATED:
        found = relationships.find_definition_for_creation(relation_type, source_type, target_type)
        if found is None:
            raise ValidationError(
                f"'{relation_type}' isn't a valid relationship between {source_type} and {target_type}."
            )
        definition, is_reversed = found
        stored_relation_type = definition.name
        if is_reversed:
            store_source_model, store_source, store_target_model, store_target = target_model, target, source_model, source

    relation, created = KnowledgeRelation.objects.get_or_create(
        organization=actor.organization,
        source_content_type=ContentType.objects.get_for_model(store_source_model),
        source_object_id=store_source.pk,
        target_content_type=ContentType.objects.get_for_model(store_target_model),
        target_object_id=store_target.pk,
        relation_type=stored_relation_type,
        defaults={"created_by": actor},
    )
    if created:
        log_action(
            actor=actor,
            action="relation.create",
            target=relation,
            metadata={
                "source": f"{source_type}:{source.pk}",
                "target": f"{target_type}:{target.pk}",
                "relation_type": stored_relation_type,
            },
            request=request,
        )
    return relation


def delete_relation(*, relation: KnowledgeRelation, actor, request=None) -> None:
    can_edit_source = _can_edit_relatable(actor, relation.source_content_type.model, relation.source)
    can_edit_target = _can_edit_relatable(actor, relation.target_content_type.model, relation.target)
    if not (can_edit_source or can_edit_target):
        raise PermissionDenied("You can only remove related content from something you own (or have edit rights on).")
    log_action(
        actor=actor,
        action="relation.delete",
        metadata={"relation_id": str(relation.pk)},
        request=request,
    )
    relation.delete()


def add_restricted_access(*, actor, request=None, content_type: str, object_id, user_id) -> RestrictedAccessGrant:
    """Grants `user_id` (a fellow org member) access to a RESTRICTED item, on
    top of whoever already qualifies via knowledge.visibility's rules. Only
    the item's owner/creator or an `<type>.update`-permission holder may
    manage its grant list - the same edit-rights check relations already
    use, since "who can attach a relation to this" and "who may grant
    access to this" are the same kind of decision. The grantee is resolved
    within actor's own organization, which combined with _resolve_relatable
    resolving the item the same way is what keeps a grant from ever
    crossing organizations."""
    from accounts.models import User

    _, instance = _resolve_relatable(content_type, object_id, actor.organization)
    if not _can_edit_relatable(actor, content_type, instance):
        raise PermissionDenied("You can only manage access to content you own (or have edit rights on).")
    granted_user = User.objects.filter(pk=user_id, organization=actor.organization).first()
    if granted_user is None:
        raise ValidationError(f"No user with id {user_id} in your organization.")
    grant, created = RestrictedAccessGrant.objects.get_or_create(
        organization=actor.organization,
        content_type=ContentType.objects.get_for_model(type(instance)),
        object_id=instance.pk,
        granted_user=granted_user,
        defaults={"granted_by": actor},
    )
    if created:
        log_action(
            actor=actor,
            action="access_grant.create",
            target=instance,
            metadata={"granted_user": str(granted_user.pk)},
            request=request,
        )
    return grant


def remove_restricted_access(*, grant: RestrictedAccessGrant, actor, request=None) -> None:
    if not _can_edit_relatable(actor, grant.content_type.model, grant.target):
        raise PermissionDenied("You can only manage access to content you own (or have edit rights on).")
    log_action(
        actor=actor,
        action="access_grant.delete",
        metadata={"grant_id": str(grant.pk), "granted_user": str(grant.granted_user_id)},
        request=request,
    )
    grant.delete()


def create_bookmark(*, actor, request=None, content_type: str, object_id) -> Bookmark:
    """Bookmarking requires actually being able to see the item right now -
    checked via the same shared visibility rule as everything else, not
    just "does it exist in my org", so a bookmark attempt can never be used
    to probe for a RESTRICTED item's existence."""
    _, instance = _resolve_relatable(content_type, object_id, actor.organization)
    if not visibility_rules.can_view_instance(actor, content_type, instance):
        raise PermissionDenied("You can't bookmark content you can't access.")
    bookmark, created = Bookmark.objects.get_or_create(
        organization=actor.organization,
        user=actor,
        content_type=ContentType.objects.get_for_model(type(instance)),
        object_id=instance.pk,
    )
    if created:
        log_action(actor=actor, action="bookmark.create", target=instance, request=request)
    return bookmark


def delete_bookmark(*, bookmark: Bookmark, actor, request=None) -> None:
    log_action(actor=actor, action="bookmark.delete", metadata={"bookmark_id": str(bookmark.pk)}, request=request)
    bookmark.delete()


def bookmarks_for(viewer, content_type_name: str | None = None) -> QuerySet[Bookmark]:
    """The viewer's own bookmarks, excluding any whose target has since
    become inaccessible (e.g. it turned RESTRICTED and viewer isn't
    granted, or it was deleted) - silently dropped rather than shown as a
    placeholder, the same precedent get_relations_for already follows for a
    hidden "other side" of a relation."""
    queryset = Bookmark.objects.filter(user=viewer, organization=viewer.organization).select_related("content_type")
    if content_type_name:
        queryset = queryset.filter(content_type__model=content_type_name)
    visible_ids = [
        bookmark.id
        for bookmark in queryset
        if visibility_rules.can_view_instance(viewer, bookmark.content_type.model, bookmark.target)
    ]
    return Bookmark.objects.filter(id__in=visible_ids).order_by("-created_at")


def add_article_attachment(*, article: Article, file, actor, request=None) -> ArticleAttachment:
    _require_owner_or_permission(
        actor=actor,
        owner=article.author,
        codename="article.update",
        message="You can only attach files to your own article.",
    )
    attachment = ArticleAttachment.objects.create(article=article, file=file, uploaded_by=actor)
    confirm_stored_files(file)
    log_action(
        actor=actor,
        action="attachment.add",
        target=article,
        metadata={"file_id": str(file.pk), "filename": file.original_filename},
        request=request,
    )
    return attachment


def remove_article_attachment(*, attachment: ArticleAttachment, actor, request=None) -> None:
    _require_owner_or_permission(
        actor=actor,
        owner=attachment.article.author,
        codename="article.update",
        message="You can only remove attachments from your own article.",
    )
    log_action(
        actor=actor,
        action="attachment.remove",
        metadata={"attachment_id": str(attachment.pk), "article_id": str(attachment.article_id)},
        request=request,
    )
    attachment.delete()


def add_question_attachment(*, question: Question, file, actor, request=None) -> QuestionAttachment:
    _require_owner_or_permission(
        actor=actor,
        owner=question.author,
        codename="question.moderate",
        message="You can only attach files to your own question.",
    )
    attachment = QuestionAttachment.objects.create(question=question, file=file, uploaded_by=actor)
    confirm_stored_files(file)
    log_action(
        actor=actor,
        action="attachment.add",
        target=question,
        metadata={"file_id": str(file.pk), "filename": file.original_filename},
        request=request,
    )
    return attachment


def remove_question_attachment(*, attachment: QuestionAttachment, actor, request=None) -> None:
    _require_owner_or_permission(
        actor=actor,
        owner=attachment.question.author,
        codename="question.moderate",
        message="You can only remove attachments from your own question.",
    )
    log_action(
        actor=actor,
        action="attachment.remove",
        metadata={"attachment_id": str(attachment.pk), "question_id": str(attachment.question_id)},
        request=request,
    )
    attachment.delete()


def _relatable_visible_to(actor, content_type, instance) -> bool:
    """Whether `actor` may see `instance` as the *other side* of a relation -
    thin wrapper over the single shared RESTRICTED-visibility rule in
    knowledge/visibility.py (used to duplicate that rule per content type
    here directly, before it was consolidated)."""
    return instance is not None and visibility_rules.can_view_instance(actor, content_type.model, instance)


def get_relations_for(model_name: str, object_id, *, actor) -> list[KnowledgeRelation]:
    """Relations where the given object is either side (source or target) -
    see KnowledgeRelationSerializer for how "the other side" is resolved.

    `actor` is required (not optional) so a RESTRICTED Article/Question can
    never leak its title/id as the "other side" of a relation to a viewer who
    couldn't open it directly - see KnowledgeRelationSerializer's own
    docstring, which only ever renders "the other side", never checking its
    visibility itself."""
    _, instance = _resolve_relatable(model_name, object_id, actor.organization)
    content_type = ContentType.objects.get_for_model(type(instance))
    relations = (
        KnowledgeRelation.objects.filter(
            organization=actor.organization, source_content_type=content_type, source_object_id=object_id
        )
        | KnowledgeRelation.objects.filter(
            organization=actor.organization, target_content_type=content_type, target_object_id=object_id
        )
    ).distinct()

    visible = []
    for relation in relations:
        is_source = (
            relation.source_content_type_id == content_type.id and relation.source_object_id == object_id
        )
        other_ct, other = (
            (relation.target_content_type, relation.target)
            if is_source
            else (relation.source_content_type, relation.source)
        )
        if _relatable_visible_to(actor, other_ct, other):
            visible.append(relation)
    return visible


def period_since(period: str):
    """Start-of-period cutoff (UTC - see settings.TIME_ZONE) for a leaderboard/
    profile score window, or `None` for "all" (no filter at all - lifetime -
    rather than "since the Unix epoch", so it still counts AuditLog entries
    from before this feature existed)."""
    from django.utils import timezone

    if period == "all":
        return None
    now = timezone.now()
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "year":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"Unknown period: {period!r}")


def rank_for(scores: dict, user_id) -> "int | None":
    """1-indexed leaderboard position of user_id within `scores`, or None if
    they have no scored activity in this window - an absent rank (rather
    than e.g. "last place") is what lets the profile card render its own
    "not ranked yet" empty state instead of a misleading position."""
    if user_id not in scores:
        return None
    ranked_ids = sorted(scores, key=lambda uid: scores[uid], reverse=True)
    return ranked_ids.index(user_id) + 1


def compute_contribution_scores_for(organization, *, since=None) -> dict:
    """user_id -> total score, for the org's leaderboard - see scoring.py's
    own docstring for why this is creation-weighted (not a flat count) and
    computed on demand from AuditLog rather than a denormalized column.

    `since` restricts to AuditLog entries created on/after that instant (for
    the This Month/This Year score windows) - omitted (the default) means
    lifetime, matching the leaderboard's original all-time behavior.

    `question.accept_answer` is deliberately excluded from the generic
    CONTRIBUTION_POINTS lookup and handled as its own pass below: the log
    entry's `actor` is whoever clicked "accept" (usually the question's own
    author), but the points belong to the answer's author - resolved via the
    log's `metadata["answer_id"]`, not `log.actor`."""
    from audit.models import AuditLog

    scores: dict = {}
    generic_actions = [action for action in CONTRIBUTION_POINTS if action != ACCEPTED_ANSWER_ACTION]
    generic_logs = AuditLog.objects.filter(organization=organization, action__in=generic_actions, actor__isnull=False)
    if since is not None:
        generic_logs = generic_logs.filter(created_at__gte=since)
    for actor_id, action in generic_logs.values_list("actor_id", "action"):
        scores[actor_id] = scores.get(actor_id, 0) + CONTRIBUTION_POINTS[action]

    accept_logs = AuditLog.objects.filter(organization=organization, action=ACCEPTED_ANSWER_ACTION)
    if since is not None:
        accept_logs = accept_logs.filter(created_at__gte=since)
    answer_ids = [
        log.metadata.get("answer_id") for log in accept_logs if log.metadata.get("answer_id")
    ]
    authors_by_answer_id = {
        str(answer_id): author_id
        for answer_id, author_id in Answer.objects.filter(pk__in=answer_ids).values_list("pk", "author_id")
    }
    for answer_id in answer_ids:
        author_id = authors_by_answer_id.get(answer_id)
        if author_id is not None:
            scores[author_id] = scores.get(author_id, 0) + ACCEPTED_ANSWER_POINTS

    return scores


def leaderboard_for(organization, *, limit: int = 20, since=None) -> list[dict]:
    """Top contributors for the org's Dashboard card, sorted descending by
    score over the `since` window (None = lifetime, see
    compute_contribution_scores_for). `user` objects are attached (not just
    ids) so the caller's serializer can render avatar/name without a second
    query per row."""
    from accounts.models import User

    scores = compute_contribution_scores_for(organization, since=since)
    top_user_ids = sorted(scores, key=lambda user_id: scores[user_id], reverse=True)[:limit]
    users_by_id = {user.id: user for user in User.objects.filter(pk__in=top_user_ids)}
    return [
        {"user": users_by_id[user_id], "score": scores[user_id]}
        for user_id in top_user_ids
        if user_id in users_by_id
    ]


def contributors_for(model_name: str, obj) -> list:
    """Distinct authors of every {model}.create/{model}.update AuditLog entry
    targeting `obj` - see scoring.py's module docstring and PART 2 of the
    plan for why this reuses AuditLog instead of adding real per-type
    revision history the way ArticleRevision does for Article alone."""
    from audit.models import AuditLog

    from accounts.models import User

    content_type = ContentType.objects.get_for_model(type(obj))
    actor_ids = (
        AuditLog.objects.filter(
            target_content_type=content_type,
            target_object_id=str(obj.pk),
            action__in=[f"{model_name}.create", f"{model_name}.update"],
            actor__isnull=False,
        )
        .values_list("actor_id", flat=True)
        .distinct()
    )
    return list(User.objects.filter(pk__in=actor_ids))


# --- Component CSV import/export --------------------------------------------
#
# One column layout both ways, laid out so the workshop's inventory sheet can
# be synced in either direction: its own 11 columns first, in its own order
# and with its own dropdown labels ("In Stock", "Needs Repair", ...), then an
# "Athar ID" column the sheet needs to add once, then every other component
# field. Importing an export back unchanged is a no-op, and importing a tab
# of the sheet as-is (its own headers, no Athar ID yet) works too - see
# _HEADER_ALIASES.

INVENTORY_CSV_COLUMNS = [
    "Athar ID", "Category", "Item", "Grid Location", "Quantity", "Unit", "Condition", "Status",
    "Min. Qty Desired", "Notes", "Last Updated", "Updated By",
    "Inventory Type", "Engineering Status", "Manufacturer", "Part Number", "Link", "Visibility", "Tags",
    "Summary", "Specifications",
]


def _normalize_label(value: str) -> str:
    """"Min. Qty Desired" -> "min qty desired", "Missing / Need to Order" ->
    "missing need to order" - so headers and dropdown values match no matter
    the punctuation, spacing or case a spreadsheet ends up with."""
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


# Normalized header -> the canonical key _parse_component_row reads. Covers
# this app's own export/template columns, the older import template's names,
# and the inventory sheet's headers.
_HEADER_ALIASES = {
    "athar id": "athar_id",
    "id": "athar_id",
    "name": "name",
    "item": "name",
    "item name": "name",
    "category": "category",
    "grid location": "location",
    "location": "location",
    "quantity": "quantity",
    "quantity available": "quantity",
    "qty": "quantity",
    "unit": "unit",
    "units": "unit",
    "condition": "condition",
    # The sheet's "Status" is a stock status, this app's older template's
    # "Status" an engineering one - the two value sets don't overlap, so the
    # cell's value decides (see _parse_component_row).
    "status": "status_any",
    "stock status": "stock_status",
    "engineering status": "status",
    "component status": "status",
    "min qty desired": "min_quantity",
    "min qty": "min_quantity",
    "min quantity": "min_quantity",
    "minimum quantity": "min_quantity",
    "notes": "notes",
    "last updated": "last_updated",
    "updated by": "updated_by",
    "inventory type": "inventory_type",
    "inventory": "inventory_type",
    "type": "inventory_type",
    "manufacturer": "manufacturer",
    "part number": "part_number",
    "link": "link",
    "visibility": "visibility",
    "tags": "tags",
    "summary": "summary",
    "specifications": "specifications",
}

# Extra accepted spellings, beyond each choice's own value and label.
_CHOICE_ALIASES = {
    "missing": Component.StockStatus.MISSING,
    "need to order": Component.StockStatus.MISSING,
    "retired": Component.StockStatus.RETIRED,
    "mechanical inventory": Component.InventoryType.MECHANICAL,
    "electrical inventory": Component.InventoryType.ELECTRICAL,
}

_BLANK_NUMBER_CELLS = {"", "none", "n a", "na"}


def _person_label(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _choice_label(choices, value: str) -> str:
    return choices(value).label if value else ""


def _format_tags_for_diff(tag_names) -> str:
    # Same normalization _sync_tags applies (strip/lowercase/dedupe), so a
    # sheet's "Motor, Propulsion" and a stored ["motor", "propulsion"] read
    # as identical rather than a spurious diff.
    return ", ".join(sorted({name.strip().lower() for name in tag_names if name.strip()}))


def _format_specifications_for_diff(specifications) -> str:
    return "; ".join(f"{row['label']}: {row['value']}" for row in specifications)


def component_csv_rows(components):
    """Header row + one row per component, for views.ComponentExportView -
    see INVENTORY_CSV_COLUMNS. Caller is expected to have already
    select_related("category", "location", "updated_by")/
    prefetch_related("tags") for this to avoid N+1 queries."""
    yield INVENTORY_CSV_COLUMNS
    for component in components:
        yield [
            str(component.pk),
            component.category.name if component.category else "",
            component.name,
            component.location.name if component.location else "",
            component.quantity_available,
            component.unit,
            _choice_label(Component.Condition, component.condition),
            _choice_label(Component.StockStatus, component.stock_status),
            "" if component.min_quantity is None else component.min_quantity,
            component.inventory_notes,
            timezone.localdate(component.updated_at).isoformat(),
            _person_label(component.updated_by),
            _choice_label(Component.InventoryType, component.inventory_type),
            _choice_label(Component.Status, component.status),
            component.manufacturer,
            component.part_number,
            component.link,
            Visibility(component.visibility).label,
            _format_tags_for_diff([tag.name for tag in component.tags.all()]),
            component.summary,
            _format_specifications_for_diff(component.specifications),
        ]


def component_import_template_rows():
    """Header row + one example row per inventory tab for
    views.ComponentImportTemplateView - the same columns an export has."""
    yield INVENTORY_CSV_COLUMNS
    yield [
        "", "Hand Tools", "Example: Allen Key Set", "Fuselage Box -> Hand Tools", "1", "set", "Good", "Low Stock",
        "2", "Missing the 2mm key", "", "", "Mechanical", "", "", "", "", "Public", "", "", "",
    ]
    yield [
        "", "Motor", "Example: T-Motor AT3520 550KV", "Motors, ESCs and BECs Box", "1", "each", "New", "In Stock",
        "", "", "", "", "Electrical", "Testing", "T-Motor", "AT3520", "https://example.com/product", "Public",
        "motor, propulsion", "Short description of the component.", "KV: 550; Weight: 238g",
    ]


def _resolve_choice(raw: str, choices) -> str | None:
    """Matches `raw` against a TextChoices' values, display labels or
    _CHOICE_ALIASES, ignoring case/punctuation - so "In Stock", "IN_STOCK"
    and "in-stock" all import the same."""
    normalized = _normalize_label(raw)
    for value, label in choices.choices:
        if normalized in (_normalize_label(value), _normalize_label(label)):
            return value
    alias = _CHOICE_ALIASES.get(normalized)
    return alias if alias in choices.values else None


def _choice_error(column: str, raw: str, choices) -> ValueError:
    return ValueError(f'{column} "{raw}" must be one of {", ".join(choices.labels)}.')


def _parse_whole_number(raw: str, column: str) -> int | None:
    """None for a blank-ish cell (the sheet leaves "Min. Qty Desired" empty
    or writes "None"); accepts "3.0", which is how Excel sometimes saves 3."""
    value = raw.strip()
    if _normalize_label(value) in _BLANK_NUMBER_CELLS:
        return None
    try:
        number = float(value)
    except ValueError:
        number = -1
    if number < 0 or number != int(number):
        raise ValueError(f"{column} must be a whole number, 0 or more.")
    return int(number)


def _parse_date_cell(raw: str):
    """The sheet's "Last Updated" - ISO from this app's own export, or
    whatever date format Excel re-saved it in. None if it can't be read,
    which only turns off the conflict warning for that row."""
    value = raw.strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _parse_specifications_cell(raw: str) -> list[dict[str, str]]:
    """Parses the flattened "Label: Value; Label: Value" cell format the
    Specifications column uses - ComponentWriteSerializer.validate_specifications
    expects a list of {label, value} dicts, which a single CSV cell can't
    represent any more directly than this."""
    specifications = []
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        label, sep, value = chunk.partition(":")
        if not sep:
            raise ValueError('each specification must look like "Label: Value"')
        specifications.append({"label": label.strip(), "value": value.strip()})
    return specifications


def _parse_component_row(record: dict) -> tuple[dict, dict]:
    """Parses one row (already keyed by _HEADER_ALIASES' canonical names)
    into (fields, meta). `fields` uses the kwarg names create_component/
    update_component expect, except category/location stay plain
    `category_name`/`location_name` strings so parsing never writes to the
    database - and ONLY for cells that are filled in: a blank cell is simply
    absent, which is what makes "blank means leave the existing value alone"
    work on an update. `meta` holds the columns that steer matching rather
    than being saved (Athar ID, Last Updated). Raises ValueError on a
    malformed cell."""
    def cell(key: str) -> str:
        return (record.get(key) or "").strip()

    name = cell("name")
    if not name:
        raise ValueError("Item/Name is required.")
    fields: dict = {"name": name}

    for field, key in (
        ("category_name", "category"),
        ("location_name", "location"),
        ("manufacturer", "manufacturer"),
        ("part_number", "part_number"),
        ("link", "link"),
        ("summary", "summary"),
        ("unit", "unit"),
        ("inventory_notes", "notes"),
    ):
        if cell(key):
            fields[field] = cell(key)

    if cell("quantity"):
        quantity = _parse_whole_number(cell("quantity"), "Quantity")
        if quantity is not None:
            fields["quantity_available"] = quantity
    if cell("min_quantity"):
        min_quantity = _parse_whole_number(cell("min_quantity"), "Min. Qty Desired")
        if min_quantity is not None:
            fields["min_quantity"] = min_quantity

    for field, key, column, choices in (
        ("condition", "condition", "Condition", Component.Condition),
        ("stock_status", "stock_status", "Stock Status", Component.StockStatus),
        ("status", "status", "Engineering Status", Component.Status),
        ("inventory_type", "inventory_type", "Inventory Type", Component.InventoryType),
        ("visibility", "visibility", "Visibility", Visibility),
    ):
        raw = cell(key)
        if raw:
            resolved = _resolve_choice(raw, choices)
            if resolved is None:
                raise _choice_error(column, raw, choices)
            fields[field] = resolved

    status_raw = cell("status_any")
    if status_raw:
        engineering = _resolve_choice(status_raw, Component.Status)
        stock = _resolve_choice(status_raw, Component.StockStatus)
        if engineering:
            fields.setdefault("status", engineering)
        elif stock:
            fields.setdefault("stock_status", stock)
        else:
            raise ValueError(
                f'Status "{status_raw}" must be a stock status ({", ".join(Component.StockStatus.labels)}) '
                f'or an engineering status ({", ".join(Component.Status.labels)}).'
            )

    if cell("specifications"):
        fields["specifications"] = _parse_specifications_cell(cell("specifications"))
    if cell("tags"):
        fields["tag_names"] = [tag.strip() for tag in cell("tags").split(",") if tag.strip()]

    meta = {"athar_id": cell("athar_id"), "last_updated": _parse_date_cell(cell("last_updated"))}
    return fields, meta


# Maps a parsed field name to the key the import response's `changes` uses -
# only differs where the internal name carries a "_name"/"_names" suffix.
_DIFF_FIELD_KEYS = {"category_name": "category", "location_name": "location", "tag_names": "tags"}

_CHOICE_FIELDS = {
    "status": Component.Status,
    "stock_status": Component.StockStatus,
    "condition": Component.Condition,
    "inventory_type": Component.InventoryType,
    "visibility": Visibility,
}


def _new_field_display(field: str, value) -> str:
    if field in _CHOICE_FIELDS:
        return _choice_label(_CHOICE_FIELDS[field], value)
    if field == "tag_names":
        return _format_tags_for_diff(value)
    if field == "specifications":
        return _format_specifications_for_diff(value)
    if field in ("quantity_available", "min_quantity"):
        return "" if value is None else str(value)
    return value


def _existing_field_display(field: str, existing: Component) -> str:
    if field == "category_name":
        return existing.category.name if existing.category else ""
    if field == "location_name":
        return existing.location.name if existing.location else ""
    if field == "tag_names":
        return _format_tags_for_diff([tag.name for tag in existing.tags.all()])
    if field in _CHOICE_FIELDS:
        return _choice_label(_CHOICE_FIELDS[field], getattr(existing, field))
    return _new_field_display(field, getattr(existing, field))


def _build_field_changes(fields: dict, existing: Component | None) -> dict[str, dict[str, str]]:
    """{field: {"old": str, "new": str}} for every field `fields` specifies
    whose value actually differs - `old` is always "" for a new component.
    Case-insensitive, so a same-value-different-case cell (or a tag/category
    the sheet capitalizes differently) isn't reported as a change. Also
    includes the stock status the write will derive on its own (see
    _apply_stock_status_rule), so the preview never hides a change."""
    changes = {}
    for field, value in fields.items():
        if field == "name":
            continue
        new_display = _new_field_display(field, value)
        old_display = _existing_field_display(field, existing) if existing is not None else ""
        if old_display.strip().lower() == new_display.strip().lower():
            continue
        changes[_DIFF_FIELD_KEYS.get(field, field)] = {"old": old_display, "new": new_display}

    if "stock_status" not in fields:
        if existing is None:
            derived = derive_stock_status(fields.get("quantity_available", 0), fields.get("min_quantity"))
            changes["stock_status"] = {"old": "", "new": Component.StockStatus(derived).label}
        elif ("quantity_available" in fields or "min_quantity" in fields) and existing.stock_status in _AUTO_STOCK_STATUSES:
            derived = derive_stock_status(
                fields.get("quantity_available", existing.quantity_available),
                fields.get("min_quantity", existing.min_quantity),
                existing.stock_status,
            )
            if derived != existing.stock_status:
                changes["stock_status"] = {
                    "old": _choice_label(Component.StockStatus, existing.stock_status),
                    "new": Component.StockStatus(derived).label,
                }
    return changes


def _decode_csv_upload(csv_file) -> str:
    """UTF-8 (with or without Excel's BOM) first; then Windows-1252, which is
    what Excel's plain "CSV (Comma delimited)" save produces - so a sheet
    saved either way imports, "–" dashes included."""
    raw = csv_file.read()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValidationError({"file": ['That file isn\'t a readable CSV - save it from Excel as "CSV UTF-8".']})


def _read_import_records(text: str) -> list[tuple[int, dict]]:
    """[(row_number, {canonical_key: cell})] for every non-blank data row.
    Row numbers count the header as row 1, matching what the user sees in
    Excel. The delimiter is sniffed from the header: Excel saves CSV with ";"
    in locales that use "," as the decimal separator."""
    first_line = text.split("\n", 1)[0]
    try:
        delimiter = csv.Sniffer().sniff(first_line, delimiters=",;\t").delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = next(reader, None)
    if header is None:
        return []
    columns = [_HEADER_ALIASES.get(_normalize_label(heading)) for heading in header]
    if "name" not in columns:
        raise ValidationError(
            {"file": ['No "Item" or "Name" column found - the first row must be the column headers.']}
        )

    records = []
    for row_number, cells in enumerate(reader, start=2):
        if not any(cell.strip() for cell in cells):
            continue  # the sheet's empty trailing rows
        record: dict[str, str] = {}
        for key, cell in zip(columns, cells):
            if key and not record.get(key):
                record[key] = cell
        records.append((row_number, record))
    return records


def _duplicate_key(entry: dict) -> tuple[str, str]:
    fields = entry["fields"]
    return fields["name"].strip().lower(), fields.get("location_name", "").strip().lower()


def _merge_duplicate_entries(group: list[dict]) -> None:
    """Folds every later row of a same-item-same-place group into the first:
    quantities are added up, distinct notes joined, and any field the first
    row left blank is taken from the later rows."""
    first = group[0]["fields"]
    quantities = [entry["fields"]["quantity_available"] for entry in group if "quantity_available" in entry["fields"]]
    if quantities:
        first["quantity_available"] = sum(quantities)
    notes = []
    for entry in group:
        note = entry["fields"].get("inventory_notes", "")
        if note and note not in notes:
            notes.append(note)
    if notes:
        first["inventory_notes"] = "; ".join(notes)
    for entry in group[1:]:
        for field, value in entry["fields"].items():
            first.setdefault(field, value)
        entry["merged_into"] = group[0]["row"]
    group[0]["warnings"].append(
        f"Merged with row(s) {', '.join(str(entry['row']) for entry in group[1:])} - quantities added up."
    )


def _find_component_for_entry(entry: dict, *, actor, claimed: set, remaining_in_group: int):
    """Returns (component or None, error message or None). An Athar ID
    matches exactly that component. Otherwise a row matches on Item name
    plus Grid Location (both case-insensitive), falling back to a same-named
    component with no location yet, so a first sheet import attaches to
    components that already existed on the website. `claimed` holds
    components earlier rows already matched, which is what lets two
    identical rows pair up with two identical components in order."""
    organization_components = Component.objects.filter(organization=actor.organization).select_related(
        "category", "location"
    )
    athar_id = entry["meta"]["athar_id"]
    if athar_id:
        try:
            component = organization_components.filter(pk=uuid.UUID(athar_id)).first()
        except ValueError:
            component = None
        if component is None:
            return None, (
                f'No component has Athar ID "{athar_id}" - it may have been deleted on the website. '
                "Clear the Athar ID cell to import this row as a new component."
            )
        return component, None

    fields = entry["fields"]
    same_name = organization_components.filter(name__iexact=fields["name"]).exclude(pk__in=claimed).order_by("created_at")
    location_name = fields.get("location_name", "")
    if location_name:
        candidates = list(same_name.filter(location__name__iexact=location_name)) or list(
            same_name.filter(location__isnull=True)
        )
    else:
        candidates = list(same_name)
    if len(candidates) > remaining_in_group:
        where = f' at "{location_name}"' if location_name else ""
        return None, (
            f'{len(candidates)} components named "{fields["name"]}"{where} already exist, so this row can\'t '
            "tell which one it means. Export from the website and use its Athar ID column to match exactly."
        )
    return (candidates[0] if candidates else None), None


def _classify_entry(entry: dict, *, actor, claimed: set, remaining_in_group: int, default_inventory_type: str) -> dict:
    """One import row's outcome, purely in memory: {"action": "create"|
    "update"|"unchanged"|"error", ...} - see import_components_csv."""
    result = {"row": entry["row"], "name": entry["fields"]["name"], "warnings": entry["warnings"]}
    component, error = _find_component_for_entry(
        entry, actor=actor, claimed=claimed, remaining_in_group=remaining_in_group
    )
    if error:
        return {**result, "action": "error", "message": error}

    fields = dict(entry["fields"])
    fields.pop("name")
    if default_inventory_type and "inventory_type" not in fields and (component is None or not component.inventory_type):
        fields["inventory_type"] = default_inventory_type

    if component is None:
        changes = _build_field_changes(fields, None)
        return {**result, "action": "create", "changes": changes, "fields": {"name": entry["fields"]["name"], **fields}}

    claimed.add(component.pk)
    result["name"] = component.name
    if entry["meta"]["athar_id"] and component.name.strip().lower() != entry["fields"]["name"].strip().lower():
        fields["name"] = entry["fields"]["name"]  # renamed in the sheet
    changes = _build_field_changes(fields, component)
    if "name" in fields:
        changes["name"] = {"old": component.name, "new": fields["name"]}
    if not changes:
        return {**result, "action": "unchanged"}
    if not actor.has_permission("component.update"):
        return {**result, "action": "error", "message": f'"{component.name}" already exists and you don\'t have permission to update it.'}

    last_updated = entry["meta"]["last_updated"]
    edited_on = timezone.localdate(component.updated_at)
    if last_updated and edited_on > last_updated:
        result["warnings"] = [
            *result["warnings"],
            f"Changed on the website on {edited_on.isoformat()}, after this row's Last Updated "
            f"({last_updated.isoformat()}) - importing overwrites those website changes.",
        ]
    return {**result, "action": "update", "changes": changes, "component": component, "fields": fields}


def _resolve_fields_for_apply(fields: dict, *, actor, request=None) -> dict:
    """Only called once a row is actually being written - swaps the
    preview-safe `category_name` string for a real, possibly just-created
    ComponentCategory. `location_name` is resolved by create_component/
    update_component themselves."""
    resolved = dict(fields)
    if "category_name" in resolved:
        resolved["category"] = get_or_create_component_category(resolved.pop("category_name"), actor=actor, request=request)
    return resolved


def import_components_csv(
    *, actor, request=None, csv_file, commit: bool, duplicates: str = "separate", default_inventory_type: str = ""
) -> dict:
    """Two-phase bulk import for components (see views.ComponentImportView).

    With commit=False (the frontend's first call, once the user picks a
    file), this is a pure preview: every row is matched and diffed against
    the organization's components but NOTHING is written - not even an
    auto-created category or location. With commit=True the frontend
    re-sends the identical file after the user confirms, and the rows are
    applied through create_component/update_component, so audit logging,
    tag sync and the stock-status rule stay identical to a normal edit.

    `duplicates` decides what happens to rows with the same Item and Grid
    Location (and no Athar ID): "separate" keeps each as its own component
    (paired, in order, with same-named components that already exist);
    "merge" folds them into one row first (see _merge_duplicate_entries).
    `default_inventory_type` is the tab the file came from - used for rows
    with no Inventory Type cell, on new components and on existing ones that
    don't have a type yet.

    Returns {"rows": [{"row", "action": "create"|"update"|"unchanged"|
    "error"|"merged", "name"?, "changes"?, "message"?, "warnings",
    "merged_into"?}], "summary": {"create", "update", "unchanged", "error",
    "merged", "duplicate_groups"}} plus, when commit=True, "applied":
    {"created", "updated", "skipped"}."""
    records = _read_import_records(_decode_csv_upload(csv_file))

    entries = []
    for row_number, record in records:
        try:
            fields, meta = _parse_component_row(record)
        except ValueError as exc:
            entries.append({"row": row_number, "error": str(exc)})
            continue
        entries.append({"row": row_number, "fields": fields, "meta": meta, "warnings": []})

    groups: dict[tuple, list[dict]] = {}
    for entry in entries:
        if "fields" in entry and not entry["meta"]["athar_id"]:
            groups.setdefault(_duplicate_key(entry), []).append(entry)
    duplicate_groups = [group for group in groups.values() if len(group) > 1]
    for group in duplicate_groups:
        if duplicates == "merge":
            _merge_duplicate_entries(group)
        else:
            for entry in group[1:]:
                entry["warnings"].append(
                    f"Same item and location as row {group[0]['row']} - kept as a separate component."
                )

    seen_ids: dict[str, int] = {}
    for entry in entries:
        athar_id = entry.get("meta", {}).get("athar_id", "").lower()
        if athar_id and "merged_into" not in entry:
            if athar_id in seen_ids:
                entry["error"] = f"This Athar ID is also used on row {seen_ids[athar_id]} - each component can appear only once."
            else:
                seen_ids[athar_id] = entry["row"]

    # Athar ID rows claim their components first, so name matching below can
    # never hand an ID'd component to a different row.
    claimed: set = set()
    results: dict[int, dict] = {}
    ordered = sorted(
        (entry for entry in entries if "error" not in entry and "merged_into" not in entry),
        key=lambda entry: (not entry["meta"]["athar_id"], entry["row"]),
    )
    position_in_group: dict[tuple, int] = {}
    for entry in ordered:
        remaining = 1
        if not entry["meta"]["athar_id"] and duplicates != "merge":
            key = _duplicate_key(entry)
            index = position_in_group.get(key, 0)
            position_in_group[key] = index + 1
            remaining = len(groups[key]) - index
        results[entry["row"]] = _classify_entry(
            entry, actor=actor, claimed=claimed, remaining_in_group=remaining, default_inventory_type=default_inventory_type
        )
    for entry in entries:
        if "error" in entry:
            results[entry["row"]] = {"row": entry["row"], "action": "error", "message": entry["error"], "warnings": []}
        elif "merged_into" in entry:
            results[entry["row"]] = {
                "row": entry["row"], "action": "merged", "name": entry["fields"]["name"],
                "merged_into": entry["merged_into"], "warnings": [],
            }

    created = updated = 0
    rows = []
    for row_number in sorted(results):
        result = results[row_number]
        if commit and result["action"] == "create":
            create_component(actor=actor, request=request, **{
                "status": "", **_resolve_fields_for_apply(result["fields"], actor=actor, request=request)
            })
            created += 1
        elif commit and result["action"] == "update":
            update_component(
                component=result["component"], actor=actor, request=request,
                **_resolve_fields_for_apply(result["fields"], actor=actor, request=request),
            )
            updated += 1
        rows.append({key: value for key, value in result.items() if key not in ("fields", "component")})

    summary = {action: sum(1 for row in rows if row["action"] == action) for action in ("create", "update", "unchanged", "error", "merged")}
    summary["duplicate_groups"] = len(duplicate_groups)
    response = {"rows": rows, "summary": summary}
    if commit:
        response["applied"] = {"created": created, "updated": updated, "skipped": summary["unchanged"]}
    return response


def inventory_summary(components: QuerySet) -> dict:
    """The inventory sheet's Summary tab: totals per stock status, and per
    category broken down by stock status. "UNTRACKED" counts components
    whose stock was never set (they predate inventory tracking)."""
    statuses = [*Component.StockStatus.values, "UNTRACKED"]

    def empty_counts() -> dict:
        return {status: 0 for status in statuses}

    totals = empty_counts()
    by_category: dict = {}
    for row in components.order_by().values("category__name", "stock_status").annotate(count=Count("id")):
        status = row["stock_status"] or "UNTRACKED"
        totals[status] += row["count"]
        category = by_category.setdefault(row["category__name"], {"total": 0, "by_status": empty_counts()})
        category["total"] += row["count"]
        category["by_status"][status] += row["count"]
    return {
        "total": sum(totals.values()),
        "by_status": totals,
        "by_category": [
            {"category": name, **counts}
            for name, counts in sorted(by_category.items(), key=lambda item: (item[0] is None, (item[0] or "").lower()))
        ],
    }
