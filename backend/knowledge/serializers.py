from rest_framework import serializers

from accounts.models import User
from files.models import StoredFile
from files.serializers import StoredFileSerializer

from . import relationships
from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
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
    Sop,
    SopAttachment,
    Tag,
    Test,
    TestAttachment,
)


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal - deliberately NOT accounts.UserSerializer, which also exposes
    roles/permissions. Every article/question reader would otherwise see
    every author's full permission set, since article.read is granted to
    every seeded role including Guest."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "title", "username"]


class UserProfileSerializer(serializers.ModelSerializer):
    """Public-safe profile shape for a user's contributions page - same
    minimal fields as AuthorSerializer above (never roles/permissions) plus
    date_joined and the aggregate contribution counts the view computes and
    passes in via context - there's no model field backing `stats`."""

    stats = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "title", "username", "date_joined", "stats"]

    def get_stats(self, obj: User) -> dict:
        return self.context["stats"]


class CategorySerializer(serializers.ModelSerializer):
    article_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "article_count"]

    def get_article_count(self, obj: Category) -> int:
        return obj.articles.filter(status=Article.Status.PUBLISHED).count()


class CategoryWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["name", "description"]


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name"]


class TagWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["name"]


class ArticleRevisionSerializer(serializers.ModelSerializer):
    edited_by = AuthorSerializer(read_only=True)

    class Meta:
        model = ArticleRevision
        fields = ["id", "title", "content", "edited_by", "created_at"]


class ArticleListSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    author = AuthorSerializer(read_only=True)

    class Meta:
        model = Article
        fields = [
            "id",
            "title",
            "slug",
            "excerpt",
            "status",
            "visibility",
            "category",
            "tags",
            "author",
            "created_at",
            "updated_at",
            "published_at",
        ]


class ArticleDetailSerializer(ArticleListSerializer):
    class Meta(ArticleListSerializer.Meta):
        fields = [*ArticleListSerializer.Meta.fields, "content"]


class ArticleWriteSerializer(serializers.ModelSerializer):
    # No `status` field - status only changes via the dedicated submit/
    # publish endpoints (see views.py), keeping the state machine single-path.
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Article
        fields = ["title", "excerpt", "content", "category_id", "tag_names", "visibility"]


class AnswerSerializer(serializers.ModelSerializer):
    author = AuthorSerializer(read_only=True)
    is_accepted = serializers.SerializerMethodField()

    class Meta:
        model = Answer
        fields = ["id", "question_id", "body", "author", "is_accepted", "created_at", "updated_at"]

    def get_is_accepted(self, obj: Answer) -> bool:
        return obj.question.accepted_answer_id == obj.id


class AnswerWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Answer
        fields = ["body"]


class QuestionListSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    author = AuthorSerializer(read_only=True)
    answer_count = serializers.SerializerMethodField()
    has_accepted_answer = serializers.SerializerMethodField()
    promoted_to_article = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            "id",
            "title",
            "status",
            "visibility",
            "tags",
            "author",
            "answer_count",
            "has_accepted_answer",
            "promoted_to_article",
            "created_at",
            "updated_at",
        ]

    def get_answer_count(self, obj: Question) -> int:
        return obj.answers.count()

    def get_has_accepted_answer(self, obj: Question) -> bool:
        return obj.accepted_answer_id is not None

    # SerializerMethodField (not PrimaryKeyRelatedField) so this stringifies
    # the UUID like every other id field - PrimaryKeyRelatedField.to_representation
    # returns the raw pk (a uuid.UUID object) unless a pk_field is set.
    def get_promoted_to_article(self, obj: Question) -> str | None:
        return str(obj.promoted_to_article_id) if obj.promoted_to_article_id else None


class QuestionDetailSerializer(QuestionListSerializer):
    answers = serializers.SerializerMethodField()

    class Meta(QuestionListSerializer.Meta):
        fields = [*QuestionListSerializer.Meta.fields, "body", "answers"]

    def get_answers(self, obj: Question) -> list:
        # Accepted answer first, then chronological - needs obj.accepted_answer_id,
        # which lives on the parent Question, so this can't be done in AnswerSerializer.
        answers = list(obj.answers.select_related("author").all())
        answers.sort(key=lambda a: a.id != obj.accepted_answer_id)
        return AnswerSerializer(answers, many=True).data


class QuestionWriteSerializer(serializers.ModelSerializer):
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Question
        fields = ["title", "body", "tag_names", "visibility"]


class AcceptAnswerSerializer(serializers.Serializer):
    answer_id = serializers.UUIDField(allow_null=True)


class KnowledgeRelationSerializer(serializers.ModelSerializer):
    """This always renders the *other* side relative to context["viewer"] =
    (viewer_content_type, viewer_object_id), which the view passes in, rather
    than exposing source/target directly. `relation_label` is the direction-
    aware verb (e.g. "USES" from the source's side, "USED_IN" from the
    target's side, per knowledge/relationships.py's registry) - falls back to
    the stored relation_type verbatim (typically the generic "RELATED",
    symmetric either way) when no registry entry matches."""

    other_type = serializers.SerializerMethodField()
    other_id = serializers.SerializerMethodField()
    other_title = serializers.SerializerMethodField()
    relation_label = serializers.SerializerMethodField()

    class Meta:
        model = KnowledgeRelation
        fields = ["id", "relation_type", "relation_label", "other_type", "other_id", "other_title", "created_at"]

    def _is_viewer_the_source(self, obj: KnowledgeRelation) -> bool:
        viewer_content_type, viewer_object_id = self.context["viewer"]
        return obj.source_content_type_id == viewer_content_type.id and obj.source_object_id == viewer_object_id

    def _other(self, obj: KnowledgeRelation):
        if self._is_viewer_the_source(obj):
            return obj.target_content_type, obj.target
        return obj.source_content_type, obj.source

    def get_other_type(self, obj: KnowledgeRelation) -> str:
        content_type, _ = self._other(obj)
        return content_type.model

    def get_other_id(self, obj: KnowledgeRelation) -> str | None:
        _, other = self._other(obj)
        return str(other.pk) if other else None

    def get_other_title(self, obj: KnowledgeRelation) -> str | None:
        _, other = self._other(obj)
        if other is None:
            return None
        # Article/Question/Failure/Sop use `title`; Project/Component use
        # `name` - falling back rather than renaming one set keeps each
        # model's field named what it actually is.
        return getattr(other, "title", None) or getattr(other, "name", None)

    def get_relation_label(self, obj: KnowledgeRelation) -> str:
        if obj.relation_type == relationships.GENERIC_RELATED:
            return obj.relation_type
        definition = relationships.get_definition(
            obj.relation_type, obj.source_content_type.model, obj.target_content_type.model
        )
        if definition is None:
            # Shouldn't happen if create_relation() is the only writer (it
            # only ever stores a canonical name), but stay safe rather than 500.
            return obj.relation_type
        return definition.name if self._is_viewer_the_source(obj) else definition.reverse_name


class ArticleAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = ArticleAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class QuestionAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = QuestionAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class AddAttachmentSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()


class CreateRelationSerializer(serializers.Serializer):
    """Input for POST /knowledge/relations/ - source/target identified by
    model name (article/question) rather than a raw ContentType id, so
    clients never need to know ContentType pks."""

    _RELATABLE_TYPES = ["article", "question", "project", "component", "failure", "sop", "test", "document"]

    source_type = serializers.ChoiceField(choices=_RELATABLE_TYPES)
    source_id = serializers.UUIDField()
    target_type = serializers.ChoiceField(choices=_RELATABLE_TYPES)
    target_id = serializers.UUIDField()
    # Validated against the relationship registry in services.create_relation
    # (not here - that needs source_type/target_type together, which isn't
    # available at the single-field validation stage) rather than a fixed
    # ChoiceField, since which verbs are valid depends on the type pair.
    relation_type = serializers.CharField(default="RELATED")


# --- Engineering domain ----------------------------------------------------


class ProjectListSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Project
        fields = ["id", "name", "status", "tags", "created_by", "created_at", "updated_at"]


class ProjectDetailSerializer(ProjectListSerializer):
    class Meta(ProjectListSerializer.Meta):
        fields = [*ProjectListSerializer.Meta.fields, "description"]


class ProjectWriteSerializer(serializers.ModelSerializer):
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Project
        fields = ["name", "description", "status", "tag_names"]


class ComponentListSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Component
        fields = [
            "id",
            "name",
            "category",
            "manufacturer",
            "part_number",
            "status",
            "specifications",
            "tags",
            "created_by",
            "created_at",
            "updated_at",
        ]


class ComponentDetailSerializer(ComponentListSerializer):
    class Meta(ComponentListSerializer.Meta):
        fields = [*ComponentListSerializer.Meta.fields, "summary"]


class ComponentWriteSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Component
        fields = [
            "name",
            "category_id",
            "manufacturer",
            "part_number",
            "status",
            "summary",
            "specifications",
            "tag_names",
        ]

    def validate_specifications(self, value):
        if not isinstance(value, list) or not all(
            isinstance(row, dict) and {"label", "value"} <= row.keys() for row in value
        ):
            raise serializers.ValidationError("specifications must be a list of {label, value} objects.")
        return value


class FailureListSerializer(serializers.ModelSerializer):
    component = ComponentListSerializer(read_only=True)
    project = ProjectListSerializer(read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Failure
        fields = [
            "id",
            "title",
            "component",
            "project",
            "aircraft",
            "date",
            "severity",
            "status",
            "created_by",
            "created_at",
            "updated_at",
        ]


class FailureDetailSerializer(FailureListSerializer):
    class Meta(FailureListSerializer.Meta):
        fields = [*FailureListSerializer.Meta.fields, "summary", "root_cause", "corrective_action", "preventive_action"]


class FailureWriteSerializer(serializers.ModelSerializer):
    component_id = serializers.PrimaryKeyRelatedField(
        source="component", queryset=Component.objects.all(), allow_null=True, required=False
    )
    project_id = serializers.PrimaryKeyRelatedField(
        source="project", queryset=Project.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = Failure
        fields = [
            "title",
            "component_id",
            "project_id",
            "aircraft",
            "date",
            "severity",
            "status",
            "summary",
            "root_cause",
            "corrective_action",
            "preventive_action",
        ]


class SopListSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Sop
        fields = ["id", "title", "category", "mandatory", "tags", "created_by", "created_at", "updated_at"]


class SopDetailSerializer(SopListSerializer):
    class Meta(SopListSerializer.Meta):
        fields = [*SopListSerializer.Meta.fields, "safety_notes", "content"]


class SopWriteSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Sop
        fields = ["title", "category_id", "mandatory", "safety_notes", "content", "tag_names"]


class TestListSerializer(serializers.ModelSerializer):
    project = ProjectListSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Test
        fields = [
            "id",
            "title",
            "test_type",
            "date",
            "location",
            "project",
            "status",
            "pass_fail",
            "tags",
            "created_by",
            "created_at",
            "updated_at",
        ]


class TestDetailSerializer(TestListSerializer):
    class Meta(TestListSerializer.Meta):
        fields = [*TestListSerializer.Meta.fields, "objective", "configuration", "procedure", "results", "conclusion"]


class TestWriteSerializer(serializers.ModelSerializer):
    project_id = serializers.PrimaryKeyRelatedField(
        source="project", queryset=Project.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Test
        fields = [
            "title",
            "test_type",
            "date",
            "location",
            "project_id",
            "objective",
            "status",
            "configuration",
            "procedure",
            "results",
            "pass_fail",
            "conclusion",
            "tag_names",
        ]


class ProjectAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = ProjectAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class ComponentAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = ComponentAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class FailureAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = FailureAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class SopAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = SopAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class TestAttachmentSerializer(serializers.ModelSerializer):
    file = StoredFileSerializer(read_only=True)
    uploaded_by = AuthorSerializer(read_only=True)

    class Meta:
        model = TestAttachment
        fields = ["id", "file", "uploaded_by", "created_at"]


class DocumentListSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)
    file = StoredFileSerializer(read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "doc_type",
            "source",
            "author",
            "organization",
            "publication_date",
            "url",
            "file",
            "category",
            "tags",
            "visibility",
            "created_by",
            "created_at",
            "updated_at",
        ]


class DocumentDetailSerializer(DocumentListSerializer):
    class Meta(DocumentListSerializer.Meta):
        fields = [*DocumentListSerializer.Meta.fields, "description"]


class DocumentWriteSerializer(serializers.ModelSerializer):
    # Two-phase upload like every other file relationship in this app -
    # upload via files.upload first, then reference the returned id here
    # (see DocumentEditor.tsx), same pattern as the *AttachmentListView.post
    # endpoints rather than a raw file field on create.
    file_id = serializers.PrimaryKeyRelatedField(
        source="file", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Document
        fields = [
            "title",
            "description",
            "doc_type",
            "source",
            "author",
            "organization",
            "publication_date",
            "url",
            "file_id",
            "category_id",
            "tag_names",
            "visibility",
        ]
