from rest_framework import serializers

from files.models import StoredFile
from files.serializers import StoredFileSerializer
from knowledge.serializers import AuthorSerializer

from . import services
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

# Every Knowledge type a Lesson may reference - mirrors
# knowledge.services._KNOWLEDGE_REFERENCE_MODELS's keys exactly (kept as its
# own list, not imported, since Training's serializer layer shouldn't reach
# into knowledge.services' private allowlist directly).
KNOWLEDGE_REFERENCE_TYPE_CHOICES = [
    "article", "question", "project", "component", "failure", "sop", "test", "document",
]


class CourseCategorySerializer(serializers.ModelSerializer):
    course_count = serializers.SerializerMethodField()

    class Meta:
        model = CourseCategory
        fields = ["id", "name", "slug", "description", "course_count"]

    def get_course_count(self, obj: CourseCategory) -> int:
        return obj.courses.filter(status=Course.Status.PUBLISHED).count()


class CourseCategoryWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseCategory
        fields = ["name", "description"]


class LearningObjectiveSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningObjective
        fields = ["id", "text", "order"]


class LearningObjectiveWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningObjective
        fields = ["text"]


class CourseResourceSerializer(serializers.ModelSerializer):
    stored_file = StoredFileSerializer(read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = CourseResource
        fields = [
            "id", "title", "description", "resource_type", "provider", "url", "stored_file",
            "is_primary", "order", "created_by", "created_at",
        ]


class CourseResourceWriteSerializer(serializers.ModelSerializer):
    # Two-phase "upload via files.upload, then reference the returned id
    # here" flow, same as knowledge.serializers.ComponentWriteSerializer's
    # photo_id / DocumentWriteSerializer's file_id.
    stored_file_id = serializers.PrimaryKeyRelatedField(
        source="stored_file", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = CourseResource
        fields = ["title", "description", "resource_type", "provider", "url", "stored_file_id", "is_primary"]

    def validate_stored_file_id(self, value):
        if value is not None and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("That file doesn't belong to your organization.")
        return value


class LessonKnowledgeReferenceSerializer(serializers.ModelSerializer):
    """Renders the *target* (the referenced Knowledge object), not the raw
    GenericFK columns - same "other side" rendering shape as
    knowledge.serializers.BookmarkSerializer."""

    content_type_name = serializers.SerializerMethodField()
    object_id = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = LessonKnowledgeReference
        fields = ["id", "content_type_name", "object_id", "title", "note", "order", "created_by", "created_at"]

    def get_content_type_name(self, obj: LessonKnowledgeReference) -> str:
        return obj.content_type.model

    def get_object_id(self, obj: LessonKnowledgeReference) -> str:
        return str(obj.object_id)

    def get_title(self, obj: LessonKnowledgeReference) -> str | None:
        target = obj.target
        if target is None:
            return None
        return getattr(target, "title", None) or getattr(target, "name", None)


class CreateKnowledgeReferenceSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=KNOWLEDGE_REFERENCE_TYPE_CHOICES)
    object_id = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class LessonSummarySerializer(serializers.ModelSerializer):
    """Lightweight shape used inside CourseModuleSerializer's nested
    curriculum listing - full content/objectives/resources live on
    LessonDetailSerializer, fetched only when a single lesson is opened."""

    class Meta:
        model = Lesson
        fields = ["id", "title", "short_description", "lesson_type", "order", "estimated_minutes", "is_required"]


class CourseModuleSerializer(serializers.ModelSerializer):
    lessons = LessonSummarySerializer(many=True, read_only=True)

    class Meta:
        model = CourseModule
        fields = ["id", "title", "description", "order", "estimated_minutes", "lessons"]


class CourseModuleWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseModule
        fields = ["title", "description", "estimated_minutes"]


class LessonDetailSerializer(serializers.ModelSerializer):
    module_id = serializers.SerializerMethodField()
    course_id = serializers.SerializerMethodField()
    objectives = LearningObjectiveSerializer(many=True, read_only=True)
    resources = CourseResourceSerializer(many=True, read_only=True)
    knowledge_references = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id", "module_id", "course_id", "title", "short_description", "lesson_type", "content",
            "order", "estimated_minutes", "is_required", "objectives", "resources", "knowledge_references",
            "created_at", "updated_at",
        ]

    def get_module_id(self, obj: Lesson) -> str:
        return str(obj.module_id)

    def get_course_id(self, obj: Lesson) -> str:
        return str(obj.module.course_id)

    def get_knowledge_references(self, obj: Lesson) -> list:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return []
        references = services.visible_knowledge_references_for(obj, request.user)
        return LessonKnowledgeReferenceSerializer(references, many=True).data


class LessonWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = ["title", "short_description", "lesson_type", "content", "estimated_minutes", "is_required"]


class CourseListSerializer(serializers.ModelSerializer):
    category = CourseCategorySerializer(read_only=True)
    author = AuthorSerializer(read_only=True)
    cover_image = StoredFileSerializer(read_only=True)
    module_count = serializers.SerializerMethodField()
    lesson_count = serializers.SerializerMethodField()
    enrollment_count = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            "id", "title", "slug", "short_description", "cover_image", "category", "difficulty",
            "estimated_minutes", "status", "author", "module_count", "lesson_count", "enrollment_count",
            "created_at", "updated_at", "published_at",
        ]

    def get_module_count(self, obj: Course) -> int:
        return obj.modules.count()

    def get_lesson_count(self, obj: Course) -> int:
        return Lesson.objects.filter(module__course=obj).count()

    def get_enrollment_count(self, obj: Course) -> int:
        return obj.enrollments.count()


class CourseDetailSerializer(CourseListSerializer):
    modules = CourseModuleSerializer(many=True, read_only=True)

    class Meta(CourseListSerializer.Meta):
        fields = [*CourseListSerializer.Meta.fields, "description", "modules"]


class CourseWriteSerializer(serializers.ModelSerializer):
    # No `status` field - status only changes via the dedicated submit/
    # publish/reject/archive/unarchive endpoints (see views.py), same
    # single-path state machine as knowledge.serializers.ArticleWriteSerializer.
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=CourseCategory.objects.all(), allow_null=True, required=False
    )
    cover_image_id = serializers.PrimaryKeyRelatedField(
        source="cover_image", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = Course
        fields = ["title", "short_description", "description", "category_id", "cover_image_id", "difficulty"]

    def validate_category_id(self, value):
        if value is not None and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("That category doesn't belong to your organization.")
        return value

    def validate_cover_image_id(self, value):
        if value is not None and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("That file doesn't belong to your organization.")
        return value


class CourseEnrollmentSerializer(serializers.ModelSerializer):
    course = CourseListSerializer(read_only=True)

    class Meta:
        model = CourseEnrollment
        fields = ["id", "course", "status", "enrolled_at", "completed_at"]


class CourseProgressSerializer(serializers.Serializer):
    enrolled = serializers.BooleanField()
    status = serializers.CharField(allow_null=True)
    percent = serializers.FloatField()
    completed_lessons = serializers.IntegerField()
    total_lessons = serializers.IntegerField()
    completed_required_lessons = serializers.IntegerField()
    total_required_lessons = serializers.IntegerField()
    next_lesson_id = serializers.CharField(allow_null=True)
    completed_lesson_ids = serializers.ListField(child=serializers.CharField())


class ReorderSerializer(serializers.Serializer):
    """Input for every /reorder/ endpoint (modules/lessons/objectives/
    resources) - a plain list of ids in the desired order. Order is implied
    by list position, not a client-supplied integer per item, so a
    duplicate/gapped order value can never corrupt state; services._reorder
    re-validates the set matches exactly before applying it."""

    order = serializers.ListField(child=serializers.UUIDField())
