from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from config.openapi import BAD_REQUEST, COMMON_ERRORS, NOT_FOUND
from config.pagination import paginated_response
from rbac.permissions import require_permission

from knowledge.models import RestrictedAccessGrant
from knowledge.serializers import AccessGrantSerializer

from . import search, services
from . import visibility as course_visibility
from .models import (
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseModule,
    CourseResource,
    Lesson,
    LearningObjective,
    LessonKnowledgeReference,
)
from .serializers import (
    CourseAccessGrantCreateSerializer,
    CourseCategorySerializer,
    CourseCategoryWriteSerializer,
    CourseDetailSerializer,
    CourseEnrollmentSerializer,
    CourseListSerializer,
    CourseModuleSerializer,
    CourseModuleWriteSerializer,
    CourseProgressSerializer,
    CourseResourceSerializer,
    CourseResourceWriteSerializer,
    CourseWriteSerializer,
    CreateKnowledgeReferenceSerializer,
    LearningObjectiveSerializer,
    LearningObjectiveWriteSerializer,
    LessonDetailSerializer,
    LessonKnowledgeReferenceSerializer,
    LessonSummarySerializer,
    LessonWriteSerializer,
    ReorderSerializer,
)


# --- Visibility helpers -------------------------------------------------------
#
# Course has no `visibility` field (see models.py's docstring) - gating is
# entirely status-based, mirroring knowledge.views._visible_article_or_404's
# shape but against Course.Status instead of RESTRICTED/PUBLIC.


def _ensure_course_visible(request, course: Course) -> None:
    # RESTRICTED first, independent of status - see training/visibility.py.
    if not course_visibility.can_view_course(request.user, course):
        raise PermissionDenied("This course isn't accessible to you.")
    if course.status == Course.Status.PUBLISHED:
        return
    if course.status == Course.Status.ARCHIVED and CourseEnrollment.objects.filter(
        course=course, user=request.user
    ).exists():
        return
    is_privileged = (
        request.user == course.author
        or request.user.has_permission("training.update")
        or request.user.has_permission("training.review")
        or request.user.has_permission("training.publish")
        or request.user.has_permission("training.manage")
    )
    if is_privileged:
        return
    raise PermissionDenied("This course isn't accessible to you.")


def _visible_course_or_404(request, pk):
    course = get_object_or_404(
        Course.objects.select_related("category", "author"), pk=pk, organization=request.user.organization
    )
    _ensure_course_visible(request, course)
    return course


def _restriction_checked_course_or_404(request, pk):
    """Only the RESTRICTED half of _ensure_course_visible - for enroll/
    progress, where a non-published course is already answered by the
    service layer (enroll_in_course's own "only a published course" 400)
    rather than hidden behind a 403."""
    course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
    if not course_visibility.can_view_course(request.user, course):
        raise PermissionDenied("This course isn't accessible to you.")
    return course


def _visible_lesson_or_404(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("module__course__category", "module__course__author"),
        pk=pk,
        module__course__organization=request.user.organization,
    )
    _ensure_course_visible(request, lesson.module.course)
    return lesson


# --- Categories ----------------------------------------------------------------


class CourseCategoryListView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("training.manage")()]
        return [require_permission("training.read")()]

    @extend_schema(
        tags=["Training"], summary="List course categories",
        responses={200: CourseCategorySerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        queryset = CourseCategory.objects.filter(organization=request.user.organization)
        return paginated_response(request, queryset, CourseCategorySerializer)

    @extend_schema(
        tags=["Training"], summary="Create a course category (requires training.manage)",
        request=CourseCategoryWriteSerializer,
        responses={201: CourseCategorySerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CourseCategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = services.create_course_category(actor=request.user, request=request, **serializer.validated_data)
        return Response(CourseCategorySerializer(category).data, status=status.HTTP_201_CREATED)


class CourseCategoryDetailView(APIView):
    permission_classes = [require_permission("training.manage")]

    @extend_schema(
        tags=["Training"], summary="Update a course category (requires training.manage)",
        request=CourseCategoryWriteSerializer,
        responses={200: CourseCategorySerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        category = get_object_or_404(CourseCategory, pk=pk, organization=request.user.organization)
        serializer = CourseCategoryWriteSerializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        category = services.update_course_category(
            category=category, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(CourseCategorySerializer(category).data)

    @extend_schema(
        tags=["Training"], summary="Delete a course category (requires training.manage; courses in it become uncategorized)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        category = get_object_or_404(CourseCategory, pk=pk, organization=request.user.organization)
        services.delete_course_category(category=category, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Courses ---------------------------------------------------------------


class CourseListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("training.create")()]
        return [require_permission("training.read")()]

    @extend_schema(
        tags=["Training"],
        summary=(
            "List courses (published by default; ?status=<state> for other states, own-authored or "
            "reviewer/publisher only; ?status=ALL for every state at once; optional ?category=<id>, ?difficulty=)"
        ),
        responses={200: CourseListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        status_param = request.query_params.get("status", Course.Status.PUBLISHED)
        queryset = course_visibility.exclude_inaccessible_courses(
            Course.objects.filter(organization=request.user.organization).select_related("category", "author"),
            request.user,
        )
        can_review = request.user.has_permission("training.review") or request.user.has_permission("training.publish")
        if status_param == "ALL":
            if not can_review:
                queryset = queryset.filter(Q(status=Course.Status.PUBLISHED) | Q(author=request.user))
        elif status_param == Course.Status.PUBLISHED:
            queryset = queryset.filter(status=Course.Status.PUBLISHED)
        elif can_review:
            queryset = queryset.filter(status=status_param)
        else:
            queryset = queryset.filter(status=status_param, author=request.user)
        category_id = request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        difficulty = request.query_params.get("difficulty")
        if difficulty:
            queryset = queryset.filter(difficulty=difficulty)
        return paginated_response(request, queryset, CourseListSerializer)

    @extend_schema(
        tags=["Training"], summary="Create a course (starts as a draft)",
        request=CourseWriteSerializer,
        responses={201: CourseDetailSerializer, 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def post(self, request):
        serializer = CourseWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        course = services.create_course(actor=request.user, request=request, **serializer.validated_data)
        return Response(CourseDetailSerializer(course, context={"request": request}).data, status=status.HTTP_201_CREATED)


class CourseDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    def get_permissions(self):
        if self.request.method == "GET":
            return [require_permission("training.read")()]
        return super().get_permissions()

    @extend_schema(
        tags=["Training"], summary="Get a course (must be published, or you must be the author/a manager)",
        responses={200: CourseDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        course = _visible_course_or_404(request, pk)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)

    @extend_schema(
        tags=["Training"], summary="Update a course (own draft/in-review/rejected, or requires training.update)",
        request=CourseWriteSerializer,
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        serializer = CourseWriteSerializer(course, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        course = services.update_course(course=course, actor=request.user, request=request, **serializer.validated_data)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)

    @extend_schema(
        tags=["Training"], summary="Delete a course (own draft, or requires training.delete; blocked while enrollments exist)",
        responses={204: OpenApiResponse(description="Deleted."), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        services.delete_course(course=course, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseSubmitView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Submit a draft/rejected course for review (author only)",
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        course = services.submit_course(course=course, actor=request.user, request=request)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)


class CoursePublishView(APIView):
    permission_classes = [require_permission("training.publish")]

    @extend_schema(
        tags=["Training"], summary="Publish a draft or in-review course",
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        course = services.publish_course(course=course, actor=request.user, request=request)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)


class CourseRejectView(APIView):
    permission_classes = [require_permission("training.review")]

    @extend_schema(
        tags=["Training"], summary="Reject an in-review course, sending it back to the author",
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        course = services.reject_course(
            course=course, actor=request.user, reason=request.data.get("reason", ""), request=request
        )
        return Response(CourseDetailSerializer(course, context={"request": request}).data)


class CourseArchiveView(APIView):
    permission_classes = [require_permission("training.archive")]

    @extend_schema(
        tags=["Training"], summary="Archive a published course",
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        course = services.archive_course(course=course, actor=request.user, request=request)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)


class CourseUnarchiveView(APIView):
    permission_classes = [require_permission("training.archive")]

    @extend_schema(
        tags=["Training"], summary="Restore an archived course to published",
        responses={200: CourseDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        course = services.unarchive_course(course=course, actor=request.user, request=request)
        return Response(CourseDetailSerializer(course, context={"request": request}).data)


class CourseAccessGrantListCreateView(APIView):
    """Names a specific org member who may see a RESTRICTED course - the
    training counterpart of knowledge.views.AccessGrantListCreateView (same
    RestrictedAccessGrant model; who already has access is read off the
    course's own `restricted_to`). Nested under the course rather than a
    generic content_type/object_id body, since courses aren't one of
    Knowledge's relatable types."""

    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Grant a user access to a restricted course (own course, or requires training.update)",
        request=CourseAccessGrantCreateSerializer,
        responses={201: AccessGrantSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        serializer = CourseAccessGrantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grant = services.add_course_access(
            course=course, actor=request.user, request=request, user_id=serializer.validated_data["user_id"]
        )
        return Response(AccessGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class CourseAccessGrantDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Revoke a user's access to a restricted course (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Revoked."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk, grant_pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        grant = get_object_or_404(
            RestrictedAccessGrant,
            pk=grant_pk,
            organization=request.user.organization,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=course.pk,
        )
        services.remove_course_access(course=course, grant=grant, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseEnrollView(APIView):
    permission_classes = [require_permission("training.read")]

    @extend_schema(
        tags=["Training"], summary="Enroll in a published course",
        responses={201: CourseEnrollmentSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = _restriction_checked_course_or_404(request, pk)
        enrollment = services.enroll_in_course(course=course, actor=request.user, request=request)
        return Response(CourseEnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)


class CourseProgressView(APIView):
    permission_classes = [require_permission("training.read")]

    @extend_schema(
        tags=["Training"],
        summary="Get the caller's progress in a course (percent, x/y lessons, next incomplete required lesson)",
        responses={200: CourseProgressSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        course = _restriction_checked_course_or_404(request, pk)
        progress = services.compute_course_progress(course=course, actor=request.user)
        return Response(CourseProgressSerializer(progress).data)


class CourseStatsView(APIView):
    permission_classes = [require_permission("training.manage")]

    @extend_schema(
        tags=["Training"], summary="Aggregate enrollment/completion statistics for a course (requires training.manage)",
        responses={200: OpenApiResponse(description="{total_enrolled, active, completed, completion_rate}"), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        return Response(services.course_stats(course))


class TrainingStatsView(APIView):
    permission_classes = [require_permission("training.manage")]

    @extend_schema(
        tags=["Training"], summary="Org-wide training admin dashboard statistics (requires training.manage)",
        responses={
            200: OpenApiResponse(
                description="{courses_by_status, total_learners, active_learners, completed_learners, most_popular_courses}"
            ),
            **COMMON_ERRORS,
        },
    )
    def get(self, request):
        return Response(services.training_stats(request.user.organization))


class MyCoursesView(APIView):
    permission_classes = [require_permission("training.read")]

    @extend_schema(
        tags=["Training"], summary="The caller's own enrollments (optional ?status=in_progress|completed)",
        responses={200: CourseEnrollmentSerializer(many=True), 400: BAD_REQUEST, **COMMON_ERRORS},
    )
    def get(self, request):
        enrollments = course_visibility.exclude_inaccessible_courses(
            CourseEnrollment.objects.filter(user=request.user).select_related(
                "course", "course__category", "course__author"
            ),
            request.user,
            course_field="course",
        )
        status_param = request.query_params.get("status")
        if status_param == "in_progress":
            enrollments = enrollments.filter(status=CourseEnrollment.Status.IN_PROGRESS)
        elif status_param == "completed":
            enrollments = enrollments.filter(status=CourseEnrollment.Status.COMPLETED)
        return paginated_response(request, enrollments, CourseEnrollmentSerializer)


class TrainingSearchView(APIView):
    """Deliberately separate from knowledge.views.SearchView - course-
    discovery intent and knowledge-lookup intent stay distinct, per the
    Training Center plan's §1.7. Reuses knowledge.search.search_filter's
    Postgres full-text + trigram implementation against the "course" field
    weights training/apps.py registers at startup."""

    permission_classes = [require_permission("training.read")]

    @extend_schema(
        tags=["Training"], summary="Search published courses (?q=; optional ?category=<id>, ?difficulty=)",
        responses={200: CourseListSerializer(many=True), **COMMON_ERRORS},
    )
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        queryset = course_visibility.exclude_inaccessible_courses(
            Course.objects.filter(
                organization=request.user.organization, status=Course.Status.PUBLISHED
            ).select_related("category", "author"),
            request.user,
        )
        category_id = request.query_params.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        difficulty = request.query_params.get("difficulty")
        if difficulty:
            queryset = queryset.filter(difficulty=difficulty)
        if query:
            queryset = search.search_filter(queryset, query, "course").order_by("-rank", "-similarity", "-updated_at")
        return paginated_response(request, queryset, CourseListSerializer)


# --- Modules -----------------------------------------------------------------


class CourseModuleListCreateView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Add a module to a course (own course, or requires training.update)",
        request=CourseModuleWriteSerializer,
        responses={201: CourseModuleSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        serializer = CourseModuleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = services.create_module(course=course, actor=request.user, request=request, **serializer.validated_data)
        return Response(CourseModuleSerializer(module).data, status=status.HTTP_201_CREATED)


class CourseModuleReorderView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Reorder a course's modules (full ordered list of module ids)",
        request=ReorderSerializer,
        responses={200: CourseModuleSerializer(many=True), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        course = get_object_or_404(Course, pk=pk, organization=request.user.organization)
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        modules = services.reorder_modules(
            course=course, actor=request.user, request=request, order=serializer.validated_data["order"]
        )
        return Response(CourseModuleSerializer(modules, many=True).data)


class CourseModuleDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Update a module (own course, or requires training.update)",
        request=CourseModuleWriteSerializer,
        responses={200: CourseModuleSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        module = get_object_or_404(CourseModule, pk=pk, course__organization=request.user.organization)
        serializer = CourseModuleWriteSerializer(module, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        module = services.update_module(module=module, actor=request.user, request=request, **serializer.validated_data)
        return Response(CourseModuleSerializer(module).data)

    @extend_schema(
        tags=["Training"], summary="Delete a module (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        module = get_object_or_404(CourseModule, pk=pk, course__organization=request.user.organization)
        services.delete_module(module=module, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Lessons -------------------------------------------------------------------


class ModuleLessonListCreateView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Add a lesson to a module (own course, or requires training.update)",
        request=LessonWriteSerializer,
        responses={201: LessonDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        module = get_object_or_404(CourseModule, pk=pk, course__organization=request.user.organization)
        serializer = LessonWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lesson = services.create_lesson(module=module, actor=request.user, request=request, **serializer.validated_data)
        return Response(LessonDetailSerializer(lesson, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ModuleLessonReorderView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Reorder a module's lessons (full ordered list of lesson ids)",
        request=ReorderSerializer,
        responses={200: LessonSummarySerializer(many=True), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        module = get_object_or_404(CourseModule, pk=pk, course__organization=request.user.organization)
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lessons = services.reorder_lessons(
            module=module, actor=request.user, request=request, order=serializer.validated_data["order"]
        )
        return Response(LessonSummarySerializer(lessons, many=True).data)


class LessonDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    def get_permissions(self):
        if self.request.method == "GET":
            return [require_permission("training.read")()]
        return super().get_permissions()

    @extend_schema(
        tags=["Training"], summary="Get a lesson (must belong to a course you can access)",
        responses={200: LessonDetailSerializer, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        lesson = _visible_lesson_or_404(request, pk)
        return Response(LessonDetailSerializer(lesson, context={"request": request}).data)

    @extend_schema(
        tags=["Training"], summary="Update a lesson (own course, or requires training.update)",
        request=LessonWriteSerializer,
        responses={200: LessonDetailSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = LessonWriteSerializer(lesson, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        lesson = services.update_lesson(lesson=lesson, actor=request.user, request=request, **serializer.validated_data)
        return Response(LessonDetailSerializer(lesson, context={"request": request}).data)

    @extend_schema(
        tags=["Training"], summary="Delete a lesson (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        services.delete_lesson(lesson=lesson, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LessonCompleteView(APIView):
    permission_classes = [require_permission("training.read")]

    @extend_schema(
        tags=["Training"], summary="Mark a lesson complete for the caller's own enrollment (idempotent)",
        responses={200: OpenApiResponse(description="{lesson_id, completed_at}"), 403: OpenApiResponse(description="Not enrolled in this lesson's course."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = _visible_lesson_or_404(request, pk)
        progress = services.mark_lesson_complete(lesson=lesson, actor=request.user, request=request)
        return Response({"lesson_id": str(lesson.pk), "completed_at": progress.completed_at})


# --- Learning objectives ---------------------------------------------------------


class LessonObjectiveListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("training.create")()]
        return [require_permission("training.read")()]

    @extend_schema(
        tags=["Training"], summary="List a lesson's learning objectives",
        responses={200: LearningObjectiveSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        lesson = _visible_lesson_or_404(request, pk)
        return Response(LearningObjectiveSerializer(lesson.objectives.all(), many=True).data)

    @extend_schema(
        tags=["Training"], summary="Add a learning objective to a lesson (own course, or requires training.update)",
        request=LearningObjectiveWriteSerializer,
        responses={201: LearningObjectiveSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = LearningObjectiveWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        objective = services.create_objective(
            lesson=lesson, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(LearningObjectiveSerializer(objective).data, status=status.HTTP_201_CREATED)


class LessonObjectiveReorderView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Reorder a lesson's learning objectives",
        request=ReorderSerializer,
        responses={200: LearningObjectiveSerializer(many=True), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        objectives = services.reorder_objectives(
            lesson=lesson, actor=request.user, request=request, order=serializer.validated_data["order"]
        )
        return Response(LearningObjectiveSerializer(objectives, many=True).data)


class ObjectiveDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Update a learning objective (own course, or requires training.update)",
        request=LearningObjectiveWriteSerializer,
        responses={200: LearningObjectiveSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        objective = get_object_or_404(
            LearningObjective, pk=pk, lesson__module__course__organization=request.user.organization
        )
        serializer = LearningObjectiveWriteSerializer(objective, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        objective = services.update_objective(
            objective=objective, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(LearningObjectiveSerializer(objective).data)

    @extend_schema(
        tags=["Training"], summary="Delete a learning objective (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        objective = get_object_or_404(
            LearningObjective, pk=pk, lesson__module__course__organization=request.user.organization
        )
        services.delete_objective(objective=objective, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Resources -----------------------------------------------------------------


class LessonResourceListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("training.create")()]
        return [require_permission("training.read")()]

    @extend_schema(
        tags=["Training"], summary="List a lesson's resources",
        responses={200: CourseResourceSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        lesson = _visible_lesson_or_404(request, pk)
        resources = lesson.resources.select_related("stored_file", "created_by")
        return Response(CourseResourceSerializer(resources, many=True).data)

    @extend_schema(
        tags=["Training"], summary="Add a resource to a lesson (own course, or requires training.update)",
        request=CourseResourceWriteSerializer,
        responses={201: CourseResourceSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = CourseResourceWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        resource = services.create_resource(
            lesson=lesson, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(CourseResourceSerializer(resource).data, status=status.HTTP_201_CREATED)


class LessonResourceReorderView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Reorder a lesson's resources",
        request=ReorderSerializer,
        responses={200: CourseResourceSerializer(many=True), 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resources = services.reorder_resources(
            lesson=lesson, actor=request.user, request=request, order=serializer.validated_data["order"]
        )
        return Response(CourseResourceSerializer(resources, many=True).data)


class ResourceDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Update a resource (own course, or requires training.update)",
        request=CourseResourceWriteSerializer,
        responses={200: CourseResourceSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def patch(self, request, pk):
        resource = get_object_or_404(CourseResource, pk=pk, lesson__module__course__organization=request.user.organization)
        serializer = CourseResourceWriteSerializer(resource, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        resource = services.update_resource(
            resource=resource, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(CourseResourceSerializer(resource).data)

    @extend_schema(
        tags=["Training"], summary="Delete a resource (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        resource = get_object_or_404(CourseResource, pk=pk, lesson__module__course__organization=request.user.organization)
        services.delete_resource(resource=resource, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Knowledge references -----------------------------------------------------


class LessonKnowledgeReferenceListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("training.create")()]
        return [require_permission("training.read")()]

    @extend_schema(
        tags=["Training"], summary="List a lesson's related Knowledge references (inaccessible/deleted targets omitted)",
        responses={200: LessonKnowledgeReferenceSerializer(many=True), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def get(self, request, pk):
        lesson = _visible_lesson_or_404(request, pk)
        references = services.visible_knowledge_references_for(lesson, request.user)
        return Response(LessonKnowledgeReferenceSerializer(references, many=True).data)

    @extend_schema(
        tags=["Training"],
        summary="Reference an existing Knowledge object from a lesson (own course, or requires training.update)",
        request=CreateKnowledgeReferenceSerializer,
        responses={201: LessonKnowledgeReferenceSerializer, 400: BAD_REQUEST, 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def post(self, request, pk):
        lesson = get_object_or_404(Lesson, pk=pk, module__course__organization=request.user.organization)
        serializer = CreateKnowledgeReferenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reference = services.create_knowledge_reference(
            lesson=lesson, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(LessonKnowledgeReferenceSerializer(reference).data, status=status.HTTP_201_CREATED)


class KnowledgeReferenceDetailView(APIView):
    permission_classes = [require_permission("training.create")]

    @extend_schema(
        tags=["Training"], summary="Remove a Knowledge reference from a lesson (own course, or requires training.update)",
        responses={204: OpenApiResponse(description="Deleted."), 404: NOT_FOUND, **COMMON_ERRORS},
    )
    def delete(self, request, pk):
        reference = get_object_or_404(
            LessonKnowledgeReference, pk=pk, lesson__module__course__organization=request.user.organization
        )
        services.delete_knowledge_reference(reference=reference, actor=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
