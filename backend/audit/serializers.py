from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_email",
            "action",
            "target_repr",
            "metadata",
            "ip_address",
            "created_at",
        ]


class ActivityEntrySerializer(serializers.ModelSerializer):
    """The org-visible activity feeds (views.KnowledgeActivityView /
    UserActivityView) - unlike AuditLogSerializer (the admin audit log), this
    exposes a display name instead of the raw actor email and resolves the
    target to a live, linkable {type, id, title} rather than the frozen
    target_repr string (which for an answer is just "Answer to <uuid>").
    Answers resolve to their question, since that's the page to open."""

    actor = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actor", "action", "target", "created_at"]

    def get_actor(self, obj: AuditLog) -> dict | None:
        from knowledge.serializers import AuthorSerializer

        return AuthorSerializer(obj.actor).data if obj.actor else None

    def get_target(self, obj: AuditLog) -> dict | None:
        target = obj.target
        if target is None:
            return None
        model_name = target._meta.model_name
        if model_name == "answer":
            target, model_name = target.question, "question"
        return {"type": model_name, "id": str(target.pk), "title": target.title}
