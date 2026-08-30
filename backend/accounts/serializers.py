from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    roles = serializers.SlugRelatedField(many=True, slug_field="name", read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "title",
            "roles",
            "permissions",
            "date_joined",
        ]

    def get_permissions(self, obj: User) -> list[str]:
        return obj.permission_codenames()


class MeUpdateSerializer(serializers.ModelSerializer):
    """Self-service profile edit - deliberately excludes email/password
    (those need their own verification/confirmation flows) and roles
    (permission-gated elsewhere, not something a user grants themselves)."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "title"]


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds the current user payload alongside the standard access/refresh pair.

    The user payload is for UI display convenience only - it must never be
    trusted as an authorization source, since the backend re-checks
    permissions on every request regardless of what this response contained.
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class RegisterSerializer(serializers.ModelSerializer):
    """Validation only - accounts.services.register_user() does the actual creation."""

    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["email", "password", "first_name", "last_name"]
