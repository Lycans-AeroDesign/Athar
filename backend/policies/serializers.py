from rest_framework import serializers

from knowledge.serializers import AuthorSerializer

from .models import PolicyDraft, PolicyKind, PolicyVersion


class PolicyVersionSerializer(serializers.ModelSerializer):
    published_by = AuthorSerializer(read_only=True)

    class Meta:
        model = PolicyVersion
        fields = ["id", "kind", "version", "title", "content", "published_at", "published_by"]


class CurrentPolicySerializer(PolicyVersionSerializer):
    """A current version plus whether the requesting user has accepted it
    (`context["accepted_ids"]`)."""

    accepted = serializers.SerializerMethodField()

    class Meta(PolicyVersionSerializer.Meta):
        fields = [*PolicyVersionSerializer.Meta.fields, "accepted"]

    def get_accepted(self, obj: PolicyVersion) -> bool:
        return obj.id in self.context["accepted_ids"]


class PolicyDraftSerializer(serializers.ModelSerializer):
    updated_by = AuthorSerializer(read_only=True)

    class Meta:
        model = PolicyDraft
        fields = ["title", "content", "updated_at", "updated_by"]


class PolicyDraftWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    content = serializers.CharField(allow_blank=True)


class PolicyOverviewSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=PolicyKind.choices)
    draft = PolicyDraftSerializer(allow_null=True)
    current = PolicyVersionSerializer(allow_null=True)
    accepted_count = serializers.IntegerField()
    member_count = serializers.IntegerField()
    has_unpublished_changes = serializers.BooleanField()


class AcceptPoliciesSerializer(serializers.Serializer):
    version_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
