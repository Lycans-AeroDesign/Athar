import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone
from django.utils.crypto import get_random_string

from rbac.models import Permission

# Excludes visually-ambiguous characters (0/O, 1/I) since these are meant to
# be read off a screen and typed in by hand.
INVITATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    # Free text, e.g. "Lead Systems Integration" or "Avionics Team Lead" -
    # display-only context shown alongside the user's name (answer cards,
    # the account page), distinct from rbac.Role which drives permissions.
    title = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    # Django admin break-glass access only - never the authorization path for the app itself.
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    # Free-form personal UI settings (e.g. {"engineering_list_filters": false}) -
    # self-service via MeView.patch, unlike everything above. A flat dict
    # rather than dedicated columns since these are display/UX toggles with
    # no query or permission implications; add keys as features need them.
    preferences = models.JSONField(default=dict, blank=True)
    date_joined = models.DateTimeField(auto_now_add=True)

    roles = models.ManyToManyField(
        "rbac.Role",
        through="rbac.UserRole",
        through_fields=("user", "role"),
        related_name="users",
        blank=True,
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email

    def has_permission(self, codename: str) -> bool:
        if self.is_superuser:
            return True
        return Permission.objects.filter(roles__users=self, codename=codename).exists()

    def permission_codenames(self) -> list[str]:
        if self.is_superuser:
            return list(Permission.objects.values_list("codename", flat=True))
        return list(
            Permission.objects.filter(roles__users=self).values_list("codename", flat=True).distinct()
        )

    # Django admin compatibility only - the app's own authorization never uses these.
    def has_perm(self, perm, obj=None):
        return self.is_superuser

    def has_module_perms(self, app_label):
        return self.is_superuser


def generate_invitation_code() -> str:
    return get_random_string(10, allowed_chars=INVITATION_CODE_ALPHABET)


class InvitationCode(models.Model):
    """Gates self-registration (see RegisterView) - every self-registered
    account still lands as Guest regardless of the code; a code only
    controls whether registration is allowed at all, not what role the
    registrant gets."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=16, unique=True, default=generate_invitation_code)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="invitation_codes"
    )
    max_uses = models.PositiveIntegerField(default=1)
    uses_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.code

    def is_valid(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.uses_count >= self.max_uses:
            return False
        if self.expires_at is not None and self.expires_at <= timezone.now():
            return False
        return True
