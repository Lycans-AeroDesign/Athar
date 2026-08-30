from rest_framework import serializers

from accounts.models import User
from files.serializers import StoredFileSerializer

from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Category,
    KnowledgeRelation,
    Question,
    QuestionAttachment,
    Tag,
)


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal - deliberately NOT accounts.UserSerializer, which also exposes
    roles/permissions. Every article/question reader would otherwise see
    every author's full permission set, since article.read is granted to
    every seeded role including Guest."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "title"]


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
    """Relations have no real directionality in the UI ("related to" reads
    the same both ways) - this always renders the *other* side relative to
    context["viewer"] = (viewer_content_type, viewer_object_id), which the
    view passes in, rather than exposing source/target directly."""

    other_type = serializers.SerializerMethodField()
    other_id = serializers.SerializerMethodField()
    other_title = serializers.SerializerMethodField()

    class Meta:
        model = KnowledgeRelation
        fields = ["id", "relation_type", "other_type", "other_id", "other_title", "created_at"]

    def _other(self, obj: KnowledgeRelation):
        viewer_content_type, viewer_object_id = self.context["viewer"]
        if obj.source_content_type_id == viewer_content_type.id and obj.source_object_id == viewer_object_id:
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
        return getattr(other, "title", None) if other else None


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

    source_type = serializers.ChoiceField(choices=["article", "question"])
    source_id = serializers.UUIDField()
    target_type = serializers.ChoiceField(choices=["article", "question"])
    target_id = serializers.UUIDField()
