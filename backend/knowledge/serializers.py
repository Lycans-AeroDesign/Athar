from rest_framework import serializers

from accounts.models import User

from .models import Answer, Article, ArticleRevision, Category, Question, Tag


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
        fields = ["title", "excerpt", "content", "category_id", "tag_names"]


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
        fields = ["title", "body", "tag_names"]


class AcceptAnswerSerializer(serializers.Serializer):
    answer_id = serializers.UUIDField(allow_null=True)
