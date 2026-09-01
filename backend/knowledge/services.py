from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action

from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Category,
    Component,
    ComponentAttachment,
    Failure,
    FailureAttachment,
    KnowledgeRelation,
    Project,
    ProjectAttachment,
    Question,
    QuestionAttachment,
    Sop,
    SopAttachment,
    Tag,
    Visibility,
)


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
        title=title,
        slug=_unique_slug(Article, title),
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
    question = Question.objects.create(title=title, body=body, author=actor, visibility=visibility)
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


# --- Engineering domain (Project/Component/Failure/Sop) -------------------
#
# No draft/review workflow and no `visibility` field on any of these (see
# models.py's module docstring) - so unlike Article/Question, there's no
# "owner can edit their own draft" case to account for. Editing/deleting is
# gated purely on the x.update/x.delete permission, full stop - matches
# docs/VISION.md #26's "Member: report failures" vs "Senior Member: update
# failures" split (create and update are deliberately separate tiers, not
# "ownership unlocks editing").


def create_project(*, actor, request=None, name, description="", status=Project.Status.ACTIVE, tag_names=None) -> Project:
    project = Project.objects.create(name=name, description=description, status=status, created_by=actor)
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
    summary="", specifications=None, tag_names=None,
) -> Component:
    component = Component.objects.create(
        name=name,
        category=category,
        manufacturer=manufacturer,
        part_number=part_number,
        status=status,
        summary=summary,
        specifications=specifications or [],
        created_by=actor,
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
    summary="", root_cause="", corrective_action="", preventive_action="",
) -> Failure:
    failure = Failure.objects.create(
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
    *, actor, request=None, title, category=None, mandatory=False, safety_notes="", content="", tag_names=None
) -> Sop:
    sop = Sop.objects.create(
        title=title, category=category, mandatory=mandatory, safety_notes=safety_notes, content=content, created_by=actor
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


# Only Article/Question/Project/Component/Failure/Sop exist as real content
# types - this allowlist is what actually stops a relation being created to
# some other model (ContentType itself has no way to express "only these").
_RELATABLE_MODELS = {
    "article": Article,
    "question": Question,
    "project": Project,
    "component": Component,
    "failure": Failure,
    "sop": Sop,
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
}


def _resolve_relatable(model_name: str, object_id):
    model = _RELATABLE_MODELS.get(model_name)
    if model is None:
        raise ValidationError(f"'{model_name}' isn't a type that can be related yet.")
    instance = model.objects.filter(pk=object_id).first()
    if instance is None:
        raise ValidationError(f"No {model_name} with id {object_id}.")
    return model, instance


def _can_edit_relatable(actor, model_name: str, instance) -> bool:
    if instance is None:
        return False
    if model_name in _RELATABLE_UPDATE_PERMISSION:
        return actor.has_permission(_RELATABLE_UPDATE_PERMISSION[model_name])
    codename = "article.update" if model_name == "article" else "question.moderate"
    return actor == getattr(instance, "author", None) or actor.has_permission(codename)


def create_relation(
    *, actor, request=None, source_type: str, source_id, target_type: str, target_id, relation_type="RELATED"
) -> KnowledgeRelation:
    source_model, source = _resolve_relatable(source_type, source_id)
    target_model, target = _resolve_relatable(target_type, target_id)
    if source_model is target_model and source.pk == target.pk:
        raise ValidationError("An item can't be related to itself.")

    if not _can_edit_relatable(actor, source_type, source):
        raise PermissionDenied("You can only add related content to something you own (or have edit rights on).")

    relation, created = KnowledgeRelation.objects.get_or_create(
        source_content_type=ContentType.objects.get_for_model(source_model),
        source_object_id=source.pk,
        target_content_type=ContentType.objects.get_for_model(target_model),
        target_object_id=target.pk,
        relation_type=relation_type,
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
                "relation_type": relation_type,
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
    mirrors views._visible_article_or_404/_visible_question_or_404's RESTRICTED
    gate. Project/Component/Failure/Sop have no `visibility` field at all, so
    they're always visible here (their own x.read permission is the real gate,
    already enforced by the RelationsView the caller is inside)."""
    if instance is None:
        return False
    if getattr(instance, "visibility", None) != Visibility.RESTRICTED:
        return True
    model_name = content_type.model
    if model_name == "article":
        return (
            actor == getattr(instance, "author", None)
            or actor.has_permission("article.review")
            or actor.has_permission("article.publish")
        )
    if model_name == "question":
        return actor == getattr(instance, "author", None) or actor.has_permission("question.moderate")
    return True


def get_relations_for(model_name: str, object_id, *, actor) -> list[KnowledgeRelation]:
    """Relations where the given object is either side (source or target) -
    see KnowledgeRelationSerializer for how "the other side" is resolved.

    `actor` is required (not optional) so a RESTRICTED Article/Question can
    never leak its title/id as the "other side" of a relation to a viewer who
    couldn't open it directly - see KnowledgeRelationSerializer's own
    docstring, which only ever renders "the other side", never checking its
    visibility itself."""
    _, instance = _resolve_relatable(model_name, object_id)
    content_type = ContentType.objects.get_for_model(type(instance))
    relations = (
        KnowledgeRelation.objects.filter(source_content_type=content_type, source_object_id=object_id)
        | KnowledgeRelation.objects.filter(target_content_type=content_type, target_object_id=object_id)
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
