from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from files.models import StoredFile
from files.serializers import StoredFileSerializer

from .models import InvitationCode, User


def normalize_unique_email(value: str) -> str:
    """Lowercased email, rejected if any account already has it in any
    case. DRF's auto-generated UniqueValidator is a case-sensitive exact
    match, which let "Alice@x.com" register next to "alice@x.com" - and
    since login matches case-insensitively and refuses ambiguous matches
    (see backends.py), that locked the original owner out. Shared with
    organization.serializers.OrganizationCreateSerializer."""
    value = value.strip().lower()
    if User.objects.filter(email__iexact=value).exists():
        raise serializers.ValidationError("A user with that email already exists.")
    return value


def check_unique_username(value: str | None, *, exclude_pk=None) -> str | None:
    """"" -> None (see models.py's username field comment), then the same
    case-insensitive uniqueness rule as normalize_unique_email - usernames
    log in through the same iexact lookup."""
    value = value or None
    if value:
        clashes = User.objects.filter(username__iexact=value)
        if exclude_pk is not None:
            clashes = clashes.exclude(pk=exclude_pk)
        if clashes.exists():
            raise serializers.ValidationError("A user with that username already exists.")
    return value


def check_password_strength(password: str, *, user: User, field: str = "password") -> None:
    """Runs settings.AUTH_PASSWORD_VALIDATORS (length, common-password list,
    all-numeric, similarity to the user's own email/name) - create_user()
    never does this on its own, so every signup path has to call it."""
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({field: list(exc.messages)}) from exc


class UserSerializer(serializers.ModelSerializer):
    roles = serializers.SlugRelatedField(many=True, slug_field="name", read_only=True)
    permissions = serializers.SerializerMethodField()
    profile_picture = StoredFileSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "title",
            "profile_picture",
            "roles",
            "permissions",
            "preferences",
            "date_joined",
            "is_active",
        ]
        # is_active is read-only here on purpose - it's an admin-only action
        # (see rbac.services.set_user_active / rbac.views.UserActiveView),
        # never self-service, so MeUpdateSerializer below deliberately never
        # lists it either.
        read_only_fields = ["is_active"]

    def get_permissions(self, obj: User) -> list[str]:
        return obj.permission_codenames()


class MeUpdateSerializer(serializers.ModelSerializer):
    """Self-service profile edit - deliberately excludes email/password
    (those need their own verification/confirmation flows) and roles
    (permission-gated elsewhere, not something a user grants themselves)."""

    # Same "upload first via files.FileUploadView, then attach by id" two-phase
    # flow as OrganizationBrandingUpdateSerializer's logo_id/favicon_id - see
    # that serializer's own comment on why the queryset here is deliberately
    # global (StoredFile.objects.all()) rather than org-scoped, and
    # validate_profile_picture_id below for the org-ownership check that
    # actually closes the gap that leaves open.
    profile_picture_id = serializers.PrimaryKeyRelatedField(
        source="profile_picture", queryset=StoredFile.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = User
        fields = ["username", "first_name", "last_name", "title", "preferences", "profile_picture_id"]

    def validate_username(self, value):
        # "" means "clear it" from the client's perspective, but the model
        # field must never store "" (see models.py's username field comment -
        # two blank strings would collide on the unique constraint).
        return check_unique_username(value, exclude_pk=self.instance.pk if self.instance else None)

    def validate_profile_picture_id(self, value):
        if value is not None and value.organization_id != self.instance.organization_id:
            raise serializers.ValidationError("That file doesn't belong to your organization.")
        return value


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
    """Validation only - accounts.services.register_user() does the actual creation
    (including checking invitation_code, since that needs a row lock - see
    services.consume_invitation_code)."""

    password = serializers.CharField(write_only=True, min_length=8)
    invitation_code = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "password", "first_name", "last_name", "invitation_code", "username"]

    def validate_email(self, value):
        return normalize_unique_email(value)

    def validate_username(self, value):
        # Same "" -> None normalization as MeUpdateSerializer.validate_username
        # (see models.py's username field comment) - optional here too, not
        # required at signup.
        return check_unique_username(value)

    def validate(self, attrs):
        check_password_strength(
            attrs["password"],
            user=User(
                email=attrs.get("email", ""),
                username=attrs.get("username"),
                first_name=attrs.get("first_name", ""),
                last_name=attrs.get("last_name", ""),
            ),
        )
        return attrs


class InvitationCodeSerializer(serializers.ModelSerializer):
    created_by = serializers.SlugRelatedField(slug_field="email", read_only=True)
    is_valid = serializers.SerializerMethodField()

    class Meta:
        model = InvitationCode
        fields = [
            "id",
            "code",
            "created_by",
            "max_uses",
            "uses_count",
            "expires_at",
            "revoked_at",
            "created_at",
            "is_valid",
        ]
        read_only_fields = fields

    def get_is_valid(self, obj: InvitationCode) -> bool:
        return obj.is_valid()


class InvitationCodeCreateSerializer(serializers.Serializer):
    max_uses = serializers.IntegerField(default=1, min_value=1)
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
