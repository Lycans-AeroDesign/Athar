from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Count, QuerySet, Sum
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from files.services import confirm_stored_files, confirm_stored_files_in_text
from knowledge import visibility as visibility_rules
from knowledge.models import Article, Component, Document, Failure, Project, Question, Sop, Test

from .models import (
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseModule,
    CourseResource,
    Lesson,
    LearningObjective,
    LessonKnowledgeReference,
    LessonProgress,
)


def _unique_slug(model, base: str, organization) -> str:
    """Same slugify-and-dedupe shape as knowledge.services._unique_slug -
    duplicated rather than imported since it's a tiny pure-ish helper and
    importing across apps for a 6-line utility isn't worth the coupling."""
    slug = slugify(base)[:120] or "item"
    candidate, suffix = slug, 1
    while model.objects.filter(organization=organization, slug=candidate).exists():
        suffix += 1
        candidate = f"{slug}-{suffix}"
    return candidate


def _require_can_manage_course(actor, course: Course) -> None:
    """Shared "it's your own course, or you hold training.update" guard for
    every module/lesson/objective/resource/knowledge-reference mutation
    within a course - same shape as knowledge.services._require_owner_or_permission."""
    if not (actor == course.author or actor.has_permission("training.update")):
        raise PermissionDenied("You can only manage your own course, or need training.update.")


def _reorder(*, queryset: QuerySet, id_order: list) -> list:
    """Two-phase order reassignment so intermediate states never collide
    with a (parent, order) unique constraint: first move every row into a
    temporary offset band unique from any real order, then assign the final
    sequential order matching id_order's position. Generic over any model
    with an `order` IntegerField - used for modules, lessons, objectives,
    and resources alike."""
    instances = {str(obj.pk): obj for obj in queryset}
    if set(instances) != {str(item_id) for item_id in id_order}:
        raise ValidationError("The reorder list must include exactly the current set of items, no more, no less.")
    with transaction.atomic():
        for offset, item_id in enumerate(id_order):
            obj = instances[str(item_id)]
            obj.order = 100000 + offset
            obj.save(update_fields=["order"])
        for index, item_id in enumerate(id_order):
            obj = instances[str(item_id)]
            obj.order = index
            obj.save(update_fields=["order"])
    return [instances[str(item_id)] for item_id in id_order]


def _recompute_course_duration(course: Course) -> None:
    """course.estimated_minutes is a denormalized sum of its lessons'
    estimated_minutes, recomputed here rather than left for callers to
    maintain by hand - avoids an expensive aggregate query on every
    course-list render. Module.estimated_minutes is informational only
    (not folded in here) to avoid double-counting against its own lessons."""
    total = Lesson.objects.filter(module__course=course).aggregate(total=Sum("estimated_minutes"))["total"] or 0
    Course.objects.filter(pk=course.pk).update(estimated_minutes=total)


# --- Categories -------------------------------------------------------------


def create_course_category(*, actor, request=None, name, description="") -> CourseCategory:
    category = CourseCategory.objects.create(
        organization=actor.organization,
        name=name,
        slug=_unique_slug(CourseCategory, name, actor.organization),
        description=description,
    )
    log_action(actor=actor, action="course_category.create", target=category, request=request)
    return category


def update_course_category(*, category: CourseCategory, actor, request=None, **fields) -> CourseCategory:
    for field, value in fields.items():
        setattr(category, field, value)
    category.save(update_fields=[*fields.keys()])
    log_action(actor=actor, action="course_category.update", target=category, request=request)
    return category


def delete_course_category(*, category: CourseCategory, actor, request=None) -> None:
    log_action(
        actor=actor,
        action="course_category.delete",
        metadata={"category_id": str(category.pk), "name": category.name},
        request=request,
    )
    category.delete()


# --- Course workflow ---------------------------------------------------------
#
# Structurally identical to knowledge.services' submit_article/publish_article/
# reject_article/archive_article/unarchive_article - see Course's own
# docstring in models.py for why the status enum (and thus this workflow)
# mirrors Article's exactly, REJECTED included.


def create_course(
    *, actor, request=None, title, short_description="", description="", category=None,
    difficulty=Course.Difficulty.BEGINNER, cover_image=None,
) -> Course:
    course = Course.objects.create(
        organization=actor.organization,
        title=title,
        slug=_unique_slug(Course, title, actor.organization),
        short_description=short_description,
        description=description,
        category=category,
        difficulty=difficulty,
        cover_image=cover_image,
        author=actor,
    )
    confirm_stored_files(cover_image)
    log_action(actor=actor, action="course.create", target=course, request=request)
    return course


def update_course(*, course: Course, actor, request=None, **fields) -> Course:
    is_owner = actor == course.author
    can_override = actor.has_permission("training.update")
    if not (is_owner or can_override):
        raise PermissionDenied("You can only edit your own course.")
    if course.status == Course.Status.ARCHIVED:
        raise ValidationError("An archived course must be unarchived before it can be edited.")
    editable_by_owner = (Course.Status.DRAFT, Course.Status.IN_REVIEW, Course.Status.REJECTED)
    if is_owner and not can_override and course.status not in editable_by_owner:
        raise PermissionDenied("A published course can only be edited by someone with training.update.")
    for field, value in fields.items():
        setattr(course, field, value)
    course.save(update_fields=[*fields.keys(), "updated_at"])
    confirm_stored_files(*fields.values())
    log_action(actor=actor, action="course.update", target=course, request=request)
    return course


def submit_course(*, course: Course, actor, request=None) -> Course:
    if actor != course.author:
        raise PermissionDenied("Only the author can submit their own draft for review.")
    if course.status not in (Course.Status.DRAFT, Course.Status.REJECTED):
        raise ValidationError("Only a draft or rejected course can be submitted for review.")
    course.status = Course.Status.IN_REVIEW
    course.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="course.submit", target=course, request=request)
    return course


def publish_course(*, course: Course, actor, request=None) -> Course:
    if course.status not in (Course.Status.DRAFT, Course.Status.IN_REVIEW):
        raise ValidationError("Only a draft or in-review course can be published.")
    course.status = Course.Status.PUBLISHED
    course.published_at = timezone.now()
    course.save(update_fields=["status", "published_at", "updated_at"])
    log_action(actor=actor, action="course.publish", target=course, request=request)
    return course


def reject_course(*, course: Course, actor, request=None, reason: str = "") -> Course:
    if course.status != Course.Status.IN_REVIEW:
        raise ValidationError("Only an in-review course can be rejected.")
    course.status = Course.Status.REJECTED
    course.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="course.reject", target=course, metadata={"reason": reason}, request=request)
    return course


def archive_course(*, course: Course, actor, request=None) -> Course:
    if course.status != Course.Status.PUBLISHED:
        raise ValidationError("Only a published course can be archived.")
    course.status = Course.Status.ARCHIVED
    course.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="course.archive", target=course, request=request)
    return course


def unarchive_course(*, course: Course, actor, request=None) -> Course:
    """Restores an archived course to PUBLISHED - deliberately doesn't touch
    published_at, matching knowledge.services.unarchive_article's precedent."""
    if course.status != Course.Status.ARCHIVED:
        raise ValidationError("Only an archived course can be unarchived.")
    course.status = Course.Status.PUBLISHED
    course.save(update_fields=["status", "updated_at"])
    log_action(actor=actor, action="course.unarchive", target=course, request=request)
    return course


def delete_course(*, course: Course, actor, request=None) -> None:
    is_own_draft = actor == course.author and course.status == Course.Status.DRAFT
    if not (is_own_draft or actor.has_permission("training.delete")):
        raise PermissionDenied("You can only delete your own draft, or need training.delete.")
    if course.enrollments.exists():
        raise ValidationError("A course with enrollments can't be deleted - archive it instead.")
    log_action(
        actor=actor, action="course.delete", metadata={"course_id": str(course.pk), "title": course.title}, request=request
    )
    course.delete()


# --- Modules / Lessons / Objectives ------------------------------------------


def create_module(*, course: Course, actor, request=None, title, description="", estimated_minutes=0) -> CourseModule:
    _require_can_manage_course(actor, course)
    module = CourseModule.objects.create(
        course=course, title=title, description=description,
        order=course.modules.count(), estimated_minutes=estimated_minutes,
    )
    log_action(actor=actor, action="module.create", target=module, request=request)
    return module


def update_module(*, module: CourseModule, actor, request=None, **fields) -> CourseModule:
    _require_can_manage_course(actor, module.course)
    for field, value in fields.items():
        setattr(module, field, value)
    module.save(update_fields=[*fields.keys(), "updated_at"])
    log_action(actor=actor, action="module.update", target=module, request=request)
    return module


def delete_module(*, module: CourseModule, actor, request=None) -> None:
    _require_can_manage_course(actor, module.course)
    course = module.course
    log_action(
        actor=actor, action="module.delete", metadata={"module_id": str(module.pk), "title": module.title}, request=request
    )
    module.delete()
    _recompute_course_duration(course)


def reorder_modules(*, course: Course, actor, request=None, order: list) -> list[CourseModule]:
    _require_can_manage_course(actor, course)
    modules = _reorder(queryset=course.modules.all(), id_order=order)
    log_action(actor=actor, action="module.reorder", target=course, request=request)
    return modules


def create_lesson(
    *, module: CourseModule, actor, request=None, title, short_description="",
    lesson_type=Lesson.LessonType.TEXT, content="", estimated_minutes=0, is_required=True,
) -> Lesson:
    _require_can_manage_course(actor, module.course)
    lesson = Lesson.objects.create(
        module=module, title=title, short_description=short_description, lesson_type=lesson_type,
        content=content, order=module.lessons.count(), estimated_minutes=estimated_minutes, is_required=is_required,
    )
    confirm_stored_files_in_text(content, organization=module.course.organization)
    log_action(actor=actor, action="lesson.create", target=lesson, request=request)
    _recompute_course_duration(module.course)
    return lesson


def update_lesson(*, lesson: Lesson, actor, request=None, **fields) -> Lesson:
    _require_can_manage_course(actor, lesson.module.course)
    for field, value in fields.items():
        setattr(lesson, field, value)
    lesson.save(update_fields=[*fields.keys(), "updated_at"])
    if "content" in fields:
        confirm_stored_files_in_text(fields["content"], organization=lesson.module.course.organization)
    log_action(actor=actor, action="lesson.update", target=lesson, request=request)
    _recompute_course_duration(lesson.module.course)
    return lesson


def delete_lesson(*, lesson: Lesson, actor, request=None) -> None:
    _require_can_manage_course(actor, lesson.module.course)
    course = lesson.module.course
    log_action(
        actor=actor, action="lesson.delete", metadata={"lesson_id": str(lesson.pk), "title": lesson.title}, request=request
    )
    lesson.delete()
    _recompute_course_duration(course)


def reorder_lessons(*, module: CourseModule, actor, request=None, order: list) -> list[Lesson]:
    _require_can_manage_course(actor, module.course)
    lessons = _reorder(queryset=module.lessons.all(), id_order=order)
    log_action(actor=actor, action="lesson.reorder", target=module, request=request)
    return lessons


def create_objective(*, lesson: Lesson, actor, request=None, text) -> LearningObjective:
    _require_can_manage_course(actor, lesson.module.course)
    objective = LearningObjective.objects.create(lesson=lesson, text=text, order=lesson.objectives.count())
    log_action(actor=actor, action="objective.create", target=lesson, request=request)
    return objective


def update_objective(*, objective: LearningObjective, actor, request=None, text) -> LearningObjective:
    _require_can_manage_course(actor, objective.lesson.module.course)
    objective.text = text
    objective.save(update_fields=["text"])
    log_action(actor=actor, action="objective.update", target=objective.lesson, request=request)
    return objective


def delete_objective(*, objective: LearningObjective, actor, request=None) -> None:
    _require_can_manage_course(actor, objective.lesson.module.course)
    log_action(actor=actor, action="objective.delete", metadata={"objective_id": str(objective.pk)}, request=request)
    objective.delete()


def reorder_objectives(*, lesson: Lesson, actor, request=None, order: list) -> list[LearningObjective]:
    _require_can_manage_course(actor, lesson.module.course)
    return _reorder(queryset=lesson.objectives.all(), id_order=order)


# --- Resources ----------------------------------------------------------------


def _validate_resource_fields(*, resource_type, provider, url, stored_file) -> None:
    if resource_type == CourseResource.ResourceType.EXTERNAL_LINK:
        if not url:
            raise ValidationError("An external-link resource requires a url.")
        if stored_file is not None:
            raise ValidationError("An external-link resource can't also reference a stored file.")
    elif resource_type == CourseResource.ResourceType.STORED_FILE:
        if stored_file is None:
            raise ValidationError("A stored-file resource requires a stored_file.")
        if url:
            raise ValidationError("A stored-file resource can't also carry a url.")
        if provider:
            raise ValidationError("provider only applies to external-link resources.")
    else:
        raise ValidationError(f"Unknown resource_type: {resource_type}")


def create_resource(
    *, lesson: Lesson, actor, request=None, title, description="", resource_type,
    provider="", url="", stored_file=None, is_primary=False,
) -> CourseResource:
    _require_can_manage_course(actor, lesson.module.course)
    _validate_resource_fields(resource_type=resource_type, provider=provider, url=url, stored_file=stored_file)
    if is_primary:
        CourseResource.objects.filter(lesson=lesson, is_primary=True).update(is_primary=False)
    resource = CourseResource.objects.create(
        lesson=lesson, title=title, description=description, resource_type=resource_type,
        provider=provider, url=url, stored_file=stored_file, is_primary=is_primary,
        order=lesson.resources.count(), created_by=actor,
    )
    confirm_stored_files(stored_file)
    log_action(
        actor=actor, action="resource.create", target=lesson, metadata={"resource_id": str(resource.pk)}, request=request
    )
    return resource


def update_resource(*, resource: CourseResource, actor, request=None, **fields) -> CourseResource:
    _require_can_manage_course(actor, resource.lesson.module.course)
    resource_type = fields.get("resource_type", resource.resource_type)
    provider = fields.get("provider", resource.provider)
    url = fields.get("url", resource.url)
    stored_file = fields.get("stored_file", resource.stored_file)
    _validate_resource_fields(resource_type=resource_type, provider=provider, url=url, stored_file=stored_file)
    if fields.get("is_primary"):
        CourseResource.objects.filter(lesson=resource.lesson, is_primary=True).exclude(pk=resource.pk).update(
            is_primary=False
        )
    for field, value in fields.items():
        setattr(resource, field, value)
    resource.save(update_fields=[*fields.keys()])
    confirm_stored_files(*fields.values())
    log_action(
        actor=actor, action="resource.update", target=resource.lesson, metadata={"resource_id": str(resource.pk)}, request=request
    )
    return resource


def delete_resource(*, resource: CourseResource, actor, request=None) -> None:
    _require_can_manage_course(actor, resource.lesson.module.course)
    log_action(actor=actor, action="resource.delete", metadata={"resource_id": str(resource.pk)}, request=request)
    resource.delete()


def reorder_resources(*, lesson: Lesson, actor, request=None, order: list) -> list[CourseResource]:
    _require_can_manage_course(actor, lesson.module.course)
    return _reorder(queryset=lesson.resources.all(), id_order=order)


# --- Knowledge references ------------------------------------------------------
#
# Deliberately NOT knowledge.services.create_relation/KnowledgeRelation - see
# LessonKnowledgeReference's own docstring in models.py for why this is its
# own model/allowlist instead. Mirrors knowledge.services._RELATABLE_MODELS/
# _resolve_relatable's shape exactly, just scoped to training's own module.

_KNOWLEDGE_REFERENCE_MODELS = {
    "article": Article,
    "question": Question,
    "project": Project,
    "component": Component,
    "failure": Failure,
    "sop": Sop,
    "test": Test,
    "document": Document,
}


def _resolve_knowledge_reference_target(model_name: str, object_id, organization):
    """Org-scoped on purpose, same as knowledge.services._resolve_relatable -
    a cross-org UUID guess resolves to "not found" rather than leaking
    whether the id exists in a different tenant."""
    model = _KNOWLEDGE_REFERENCE_MODELS.get(model_name)
    if model is None:
        raise ValidationError(f"'{model_name}' isn't a type that can be referenced yet.")
    instance = model.objects.filter(pk=object_id, organization=organization).first()
    if instance is None:
        raise ValidationError(f"No {model_name} with id {object_id}.")
    return model, instance


def create_knowledge_reference(
    *, lesson: Lesson, actor, request=None, content_type: str, object_id, note: str = ""
) -> LessonKnowledgeReference:
    _require_can_manage_course(actor, lesson.module.course)
    model, instance = _resolve_knowledge_reference_target(content_type, object_id, actor.organization)
    reference, created = LessonKnowledgeReference.objects.get_or_create(
        lesson=lesson,
        content_type=ContentType.objects.get_for_model(model),
        object_id=instance.pk,
        defaults={"note": note, "created_by": actor, "order": lesson.knowledge_references.count()},
    )
    if created:
        log_action(
            actor=actor,
            action="lesson.knowledge_reference.add",
            target=lesson,
            metadata={"reference": f"{content_type}:{instance.pk}"},
            request=request,
        )
    return reference


def delete_knowledge_reference(*, reference: LessonKnowledgeReference, actor, request=None) -> None:
    _require_can_manage_course(actor, reference.lesson.module.course)
    log_action(
        actor=actor, action="lesson.knowledge_reference.remove", metadata={"reference_id": str(reference.pk)}, request=request
    )
    reference.delete()


def visible_knowledge_references_for(lesson: Lesson, viewer) -> list[LessonKnowledgeReference]:
    """A lesson's knowledge references, dropping any whose target has since
    become inaccessible (RESTRICTED and viewer isn't privileged/granted) or
    been deleted (dangling GenericFK) - silently omitted, never a 403, same
    precedent knowledge.services.bookmarks_for follows."""
    references = lesson.knowledge_references.select_related("content_type").order_by("order")
    visible = []
    for reference in references:
        target = reference.target
        if target is None:
            continue
        if visibility_rules.can_view_instance(viewer, reference.content_type.model, target):
            visible.append(reference)
    return visible


# --- Enrollment / Progress -----------------------------------------------------


def enroll_in_course(*, course: Course, actor, request=None) -> CourseEnrollment:
    if course.status != Course.Status.PUBLISHED:
        raise ValidationError("Only a published course can be enrolled in.")
    if CourseEnrollment.objects.filter(course=course, user=actor).exists():
        raise ValidationError("You are already enrolled in this course.")
    enrollment = CourseEnrollment.objects.create(course=course, user=actor, organization=actor.organization)
    log_action(actor=actor, action="enrollment.create", target=enrollment, request=request)
    return enrollment


def _maybe_complete_course(*, enrollment: CourseEnrollment, actor, request=None) -> None:
    course = enrollment.course
    required_lesson_ids = set(
        Lesson.objects.filter(module__course=course, is_required=True).values_list("id", flat=True)
    )
    if not required_lesson_ids:
        return
    completed_ids = set(LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True))
    if required_lesson_ids <= completed_ids and enrollment.status != CourseEnrollment.Status.COMPLETED:
        enrollment.status = CourseEnrollment.Status.COMPLETED
        enrollment.completed_at = timezone.now()
        enrollment.save(update_fields=["status", "completed_at"])
        log_action(actor=actor, action="course.complete", target=enrollment, request=request)


def mark_lesson_complete(*, lesson: Lesson, actor, request=None) -> LessonProgress:
    course = lesson.module.course
    enrollment = CourseEnrollment.objects.filter(course=course, user=actor).first()
    if enrollment is None:
        raise PermissionDenied("You must be enrolled in this course to track lesson progress.")
    progress, created = LessonProgress.objects.get_or_create(enrollment=enrollment, lesson=lesson)
    if created:
        log_action(actor=actor, action="lesson.complete", target=progress, request=request)
        _maybe_complete_course(enrollment=enrollment, actor=actor, request=request)
    return progress


def compute_course_progress(*, course: Course, actor) -> dict:
    lessons = Lesson.objects.filter(module__course=course)
    total_all = lessons.count()
    total_required = lessons.filter(is_required=True).count()
    enrollment = CourseEnrollment.objects.filter(course=course, user=actor).first()
    if enrollment is None:
        return {
            "enrolled": False,
            "status": None,
            "percent": 0.0,
            "completed_lessons": 0,
            "total_lessons": total_all,
            "completed_required_lessons": 0,
            "total_required_lessons": total_required,
            "next_lesson_id": None,
            "completed_lesson_ids": [],
        }
    completed_ids = set(LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True))
    completed_all = len(completed_ids)
    completed_required = lessons.filter(is_required=True, pk__in=completed_ids).count()
    percent = round((completed_all / total_all) * 100, 1) if total_all else 0.0
    next_lesson = lessons.exclude(pk__in=completed_ids).order_by("module__order", "order").first()
    return {
        "enrolled": True,
        "status": enrollment.status,
        "percent": percent,
        "completed_lessons": completed_all,
        "total_lessons": total_all,
        "completed_required_lessons": completed_required,
        "total_required_lessons": total_required,
        "next_lesson_id": str(next_lesson.id) if next_lesson else None,
        # Full set, not just the count - lets the curriculum UI render a
        # per-lesson checkmark without a second request per lesson.
        "completed_lesson_ids": [str(lesson_id) for lesson_id in completed_ids],
    }


# --- Statistics -----------------------------------------------------------------


def course_stats(course: Course) -> dict:
    enrollments = course.enrollments.all()
    total = enrollments.count()
    completed = enrollments.filter(status=CourseEnrollment.Status.COMPLETED).count()
    active = total - completed
    completion_rate = round((completed / total) * 100, 1) if total else 0.0
    return {"total_enrolled": total, "active": active, "completed": completed, "completion_rate": completion_rate}


def training_stats(organization) -> dict:
    courses = Course.objects.filter(organization=organization)
    by_status = {choice: courses.filter(status=choice).count() for choice, _ in Course.Status.choices}
    enrollments = CourseEnrollment.objects.filter(organization=organization)
    total_learners = enrollments.values("user").distinct().count()
    active_learners = enrollments.filter(status=CourseEnrollment.Status.IN_PROGRESS).values("user").distinct().count()
    completed_learners = enrollments.filter(status=CourseEnrollment.Status.COMPLETED).values("user").distinct().count()
    most_popular = list(
        courses.filter(status=Course.Status.PUBLISHED)
        .annotate(enrolled=Count("enrollments"))
        .order_by("-enrolled")[:5]
        .values("id", "title", "enrolled")
    )
    return {
        "courses_by_status": by_status,
        "total_learners": total_learners,
        "active_learners": active_learners,
        "completed_learners": completed_learners,
        "most_popular_courses": most_popular,
    }
