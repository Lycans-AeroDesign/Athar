from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db.models import Q, QuerySet
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action

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
    log_action(actor=actor, action="project.update", target=project, request=request)
    return project


def delete_project(*, project: Project, actor, request=None) -> None:
    if not actor.has_permission("project.delete"):
        raise PermissionDenied("You need project.delete to remove this project.")
    log_action(actor=actor, action="project.delete", metadata={"project_id": str(project.pk), "name": project.name}, request=request)
    project.delete()


def create_component(
    *, actor, request=None, name, category=None, manufacturer="", part_number="", status=Component.Status.TESTING,
    summary="", specifications=None, tag_names=None, visibility=Visibility.PUBLIC,
) -> Component:
    component = Component.objects.create(
        organization=actor.organization,
        name=name,
        category=category,
        manufacturer=manufacturer,
        part_number=part_number,
        status=status,
        summary=summary,
        specifications=specifications or [],
        created_by=actor,
        visibility=visibility,
    )
    _sync_tags(component, tag_names)
    log_action(actor=actor, action="component.create", target=component, request=request)
    return component


def update_component(*, component: Component, actor, request=None, **fields) -> Component:
    if not actor.has_permission("component.update"):
        raise PermissionDenied("You need component.update to edit this component.")
    tag_names = fields.pop("tag_names", None)
    for field, value in fields.items():
        setattr(component, field, value)
    component.save(update_fields=[*fields.keys(), "updated_at"])
    _sync_tags(component, tag_names)
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
    log_action(actor=actor, action="failure.create", target=failure, request=request)
    return failure


def update_failure(*, failure: Failure, actor, request=None, **fields) -> Failure:
    if not actor.has_permission("failure.update"):
        raise PermissionDenied("You need failure.update to edit this failure report.")
    for field, value in fields.items():
        setattr(failure, field, value)
    failure.save(update_fields=[*fields.keys(), "updated_at"])
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


def compute_contribution_scores_for(organization) -> dict:
    """user_id -> total score, for the org's leaderboard - see scoring.py's
    own docstring for why this is creation-weighted (not a flat count) and
    computed on demand from AuditLog rather than a denormalized column.

    `question.accept_answer` is deliberately excluded from the generic
    CONTRIBUTION_POINTS lookup and handled as its own pass below: the log
    entry's `actor` is whoever clicked "accept" (usually the question's own
    author), but the points belong to the answer's author - resolved via the
    log's `metadata["answer_id"]`, not `log.actor`."""
    from audit.models import AuditLog

    scores: dict = {}
    generic_actions = [action for action in CONTRIBUTION_POINTS if action != ACCEPTED_ANSWER_ACTION]
    generic_logs = AuditLog.objects.filter(
        organization=organization, action__in=generic_actions, actor__isnull=False
    ).values_list("actor_id", "action")
    for actor_id, action in generic_logs:
        scores[actor_id] = scores.get(actor_id, 0) + CONTRIBUTION_POINTS[action]

    accept_logs = AuditLog.objects.filter(organization=organization, action=ACCEPTED_ANSWER_ACTION)
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


def leaderboard_for(organization, *, limit: int = 20) -> list[dict]:
    """Top contributors for the org's Dashboard card, sorted descending by
    score. `user` objects are attached (not just ids) so the caller's
    serializer can render avatar/name without a second query per row."""
    from accounts.models import User

    scores = compute_contribution_scores_for(organization)
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
