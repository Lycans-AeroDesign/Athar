from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from accounts.models import User
from files.models import StoredFile
from files.serializers import StoredFileSerializer

from . import relationships, services
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
)

# Every real relatable content type - shared by CreateRelationSerializer,
# CreateAccessGrantSerializer, and CreateBookmarkSerializer so a new type
# only ever needs to be added in one place. Was CreateRelationSerializer's
# own private _RELATABLE_TYPES before access grants/bookmarks needed the
# same list.
RELATABLE_TYPE_CHOICES = ["article", "question", "project", "component", "failure", "sop", "test", "document"]


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal - deliberately NOT accounts.UserSerializer, which also exposes
    roles/permissions. Every article/question reader would otherwise see
    every author's full permission set, since article.read is granted to
    every seeded role including Guest."""

    profile_picture = StoredFileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "title", "username", "profile_picture"]


class UserProfileSerializer(serializers.ModelSerializer):
    """Public-safe profile shape for a user's contributions page - same
    minimal fields as AuthorSerializer above (never roles/permissions) plus
    date_joined, the aggregate contribution counts, and the weighted
    leaderboard score/rank per time window (see scoring.py and
    services.period_since) - all computed by the view and passed in via
    context, no model field backing either."""

    profile_picture = StoredFileSerializer(read_only=True)
    stats = serializers.SerializerMethodField()
    # {"month": {"score": int, "rank": int|None}, "year": {...}, "all": {...}} -
    # see UserProfileView.get.
    periods = serializers.SerializerMethodField()
    total_members = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "title",
            "username",
            "profile_picture",
            "date_joined",
            "stats",
            "periods",
            "total_members",
        ]

    def get_stats(self, obj: User) -> dict:
        return self.context["stats"]

    def get_periods(self, obj: User) -> dict:
        return self.context["periods"]

    def get_total_members(self, obj: User) -> int:
        return self.context["total_members"]


class LeaderboardEntrySerializer(serializers.Serializer):
    """One row of GET /knowledge/leaderboard/ - `user` is a plain dict
    ({"user": <User>, "score": <int>}) built by services.leaderboard_for,
    not a model instance, so this is a plain Serializer, not a ModelSerializer."""

    user = AuthorSerializer(read_only=True)
    score = serializers.IntegerField(read_only=True)


class ContributorsMixin:
    """get_contributors backing a `contributors` SerializerMethodField each
    *DetailSerializer below declares directly (DRF's SerializerMetaclass only
    collects declared Fields from `Meta`-bearing bases, so the field itself
    can't live on a plain mixin - only this method can be shared) - distinct
    authors of every {type}.create/{type}.update AuditLog entry for this
    object, via services.contributors_for. See that function's own docstring
    for why this reuses AuditLog instead of adding real per-type revision
    history."""

    def get_contributors(self, obj) -> list:
        model_name = obj.__class__.__name__.lower()
        return AuthorSerializer(services.contributors_for(model_name, obj), many=True).data


class RestrictedAccessMixin:
    """get_restricted_to backing a `restricted_to` SerializerMethodField each
    *DetailSerializer below declares directly (same DRF-metaclass reason
    ContributorsMixin's own docstring gives). Lists who's been explicitly
    granted access to this item on top of its owner/creator - meaningless
    when the item isn't RESTRICTED, but returned regardless (an empty list)
    rather than omitted, so the frontend doesn't need a conditional field."""

    def get_restricted_to(self, obj) -> list:
        grants = RestrictedAccessGrant.objects.filter(
            content_type=ContentType.objects.get_for_model(type(obj)), object_id=obj.pk
        ).select_related("granted_user")
        return [
            {"grant_id": str(grant.id), "user": AuthorSerializer(grant.granted_user).data} for grant in grants
        ]


class BookmarkMixin:
    """get_bookmark_id backing a `bookmark_id` SerializerMethodField each
    *DetailSerializer below declares directly. None when the caller isn't
    authenticated or hasn't bookmarked this item; otherwise the Bookmark's
    own id, so the frontend can delete it directly without a lookup."""

    def get_bookmark_id(self, obj) -> str | None:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return None
        bookmark = Bookmark.objects.filter(
            user=request.user,
            content_type=ContentType.objects.get_for_model(type(obj)),
            object_id=obj.pk,
        ).first()
        return str(bookmark.id) if bookmark else None


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


class ArticleDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, ArticleListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(ArticleListSerializer.Meta):
        fields = [*ArticleListSerializer.Meta.fields, "content", "contributors", "restricted_to", "bookmark_id"]


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


class QuestionDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, QuestionListSerializer):
    answers = serializers.SerializerMethodField()
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(QuestionListSerializer.Meta):
        fields = [
            *QuestionListSerializer.Meta.fields,
            "body",
            "answers",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]

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

    source_type = serializers.ChoiceField(choices=RELATABLE_TYPE_CHOICES)
    source_id = serializers.UUIDField()
    target_type = serializers.ChoiceField(choices=RELATABLE_TYPE_CHOICES)
    target_id = serializers.UUIDField()
    # Validated against the relationship registry in services.create_relation
    # (not here - that needs source_type/target_type together, which isn't
    # available at the single-field validation stage) rather than a fixed
    # ChoiceField, since which verbs are valid depends on the type pair.
    relation_type = serializers.CharField(default="RELATED")


class AccessGrantSerializer(serializers.ModelSerializer):
    granted_user = AuthorSerializer(read_only=True)

    class Meta:
        model = RestrictedAccessGrant
        fields = ["id", "granted_user", "created_at"]


class CreateAccessGrantSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=RELATABLE_TYPE_CHOICES)
    object_id = serializers.UUIDField()
    user_id = serializers.UUIDField()


class BookmarkSerializer(serializers.ModelSerializer):
    type = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()

    class Meta:
        model = Bookmark
        fields = ["id", "type", "object_id", "title", "created_at"]

    def get_type(self, obj: Bookmark) -> str:
        return obj.content_type.model

    def get_title(self, obj: Bookmark) -> str | None:
        target = obj.target
        if target is None:
            return None
        return getattr(target, "title", None) or getattr(target, "name", None)


class CreateBookmarkSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=RELATABLE_TYPE_CHOICES)
    object_id = serializers.UUIDField()


# --- Engineering domain ----------------------------------------------------


class ProjectListSerializer(serializers.ModelSerializer):
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Project
        fields = ["id", "name", "status", "visibility", "tags", "created_by", "created_at", "updated_at"]


class ProjectDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, ProjectListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(ProjectListSerializer.Meta):
        fields = [
            *ProjectListSerializer.Meta.fields,
            "description",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


class ProjectWriteSerializer(serializers.ModelSerializer):
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Project
        fields = ["name", "description", "status", "visibility", "tag_names"]


class ComponentCategorySerializer(serializers.ModelSerializer):
    # Annotated by the list view (see views.ComponentCategoryListView) to
    # avoid a count query per row; falls back to counting for a single object.
    component_count = serializers.SerializerMethodField()

    class Meta:
        model = ComponentCategory
        fields = ["id", "name", "slug", "description", "component_count"]

    def get_component_count(self, obj: ComponentCategory) -> int:
        count = getattr(obj, "component_count", None)
        return obj.components.count() if count is None else count


class ComponentCategoryWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComponentCategory
        fields = ["name", "description"]


class ComponentCategoryRefSerializer(serializers.ModelSerializer):
    """What a component embeds - no count, so listing components never
    triggers a per-row count query."""

    class Meta:
        model = ComponentCategory
        fields = ["id", "name", "slug"]


class StorageLocationSerializer(serializers.ModelSerializer):
    component_count = serializers.SerializerMethodField()

    class Meta:
        model = StorageLocation
        fields = ["id", "name", "description", "component_count"]

    def get_component_count(self, obj: StorageLocation) -> int:
        count = getattr(obj, "component_count", None)
        return obj.components.count() if count is None else count


class StorageLocationWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = StorageLocation
        fields = ["name", "description"]


class StorageLocationRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = StorageLocation
        fields = ["id", "name"]


class ComponentListSerializer(serializers.ModelSerializer):
    category = ComponentCategoryRefSerializer(read_only=True)
    location = StorageLocationRefSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)
    updated_by = AuthorSerializer(read_only=True)
    photo = StoredFileSerializer(read_only=True)

    class Meta:
        model = Component
        fields = [
            "id",
            "name",
            "category",
            "photo",
            "manufacturer",
            "part_number",
            "link",
            "quantity_available",
            "status",
            "inventory_type",
            "location",
            "unit",
            "condition",
            "stock_status",
            "min_quantity",
            "specifications",
            "visibility",
            "tags",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class ComponentDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, ComponentListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(ComponentListSerializer.Meta):
        fields = [
            *ComponentListSerializer.Meta.fields,
            "summary",
            "inventory_notes",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


class ComponentWriteSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=ComponentCategory.objects.all(), allow_null=True, required=False
    )
    # Same two-phase "upload via files.upload, then attach by id" flow as
    # accounts.MeUpdateSerializer.profile_picture_id - see
    # validate_photo_id below for the matching org-ownership check.
    photo_id = serializers.PrimaryKeyRelatedField(
        source="photo", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )
    # By name, not id: typing a place that doesn't exist yet creates it (see
    # services._resolve_location_name); "" clears it.
    location_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Component
        fields = [
            "name",
            "category_id",
            "photo_id",
            "manufacturer",
            "part_number",
            "link",
            "quantity_available",
            "status",
            "inventory_type",
            "location_name",
            "unit",
            "condition",
            # "" = derive it from the quantity (see services.derive_stock_status).
            "stock_status",
            "min_quantity",
            "inventory_notes",
            "summary",
            "specifications",
            "visibility",
            "tag_names",
        ]

    def validate_specifications(self, value):
        if not isinstance(value, list) or not all(
            isinstance(row, dict) and {"label", "value"} <= row.keys() for row in value
        ):
            raise serializers.ValidationError("specifications must be a list of {label, value} objects.")
        return value

    def validate_category_id(self, value):
        if value is not None and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("That category doesn't belong to your organization.")
        return value

    def validate_photo_id(self, value):
        if value is not None and value.organization_id != self.context["request"].user.organization_id:
            raise serializers.ValidationError("That file doesn't belong to your organization.")
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
            "visibility",
            "created_by",
            "created_at",
            "updated_at",
        ]


class FailureDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, FailureListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(FailureListSerializer.Meta):
        fields = [
            *FailureListSerializer.Meta.fields,
            "summary",
            "root_cause",
            "corrective_action",
            "preventive_action",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


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
            "visibility",
        ]


class SopListSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = Sop
        fields = ["id", "title", "category", "mandatory", "visibility", "tags", "created_by", "created_at", "updated_at"]


class SopDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, SopListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(SopListSerializer.Meta):
        fields = [
            *SopListSerializer.Meta.fields,
            "safety_notes",
            "content",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


class SopWriteSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.all(), allow_null=True, required=False
    )
    tag_names = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = Sop
        fields = ["title", "category_id", "mandatory", "safety_notes", "content", "visibility", "tag_names"]


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
            "visibility",
            "tags",
            "created_by",
            "created_at",
            "updated_at",
        ]


class TestDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, TestListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(TestListSerializer.Meta):
        fields = [
            *TestListSerializer.Meta.fields,
            "objective",
            "configuration",
            "procedure",
            "results",
            "conclusion",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


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
            "visibility",
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
    # API field name kept as "organization" (the external org/author's own
    # organization, e.g. "SAE International") even though the model field
    # is now `external_organization` - see Document's own docstring for why
    # it was renamed (the multi-tenancy retrofit needed the bare
    # `organization` name for the tenant-scoping FK instead). Keeping the
    # API shape unchanged means no frontend changes were needed for this.
    organization = serializers.CharField(source="external_organization", required=False, allow_blank=True)

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


class DocumentDetailSerializer(ContributorsMixin, RestrictedAccessMixin, BookmarkMixin, DocumentListSerializer):
    contributors = serializers.SerializerMethodField()
    restricted_to = serializers.SerializerMethodField()
    bookmark_id = serializers.SerializerMethodField()

    class Meta(DocumentListSerializer.Meta):
        fields = [
            *DocumentListSerializer.Meta.fields,
            "description",
            "contributors",
            "restricted_to",
            "bookmark_id",
        ]


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
    # See DocumentListSerializer's matching comment - API name unchanged.
    organization = serializers.CharField(
        source="external_organization", required=False, allow_blank=True
    )

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
