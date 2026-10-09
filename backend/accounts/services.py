import datetime
import hashlib
import secrets

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.services import log_action
from files.services import confirm_stored_files
from rbac.models import Role

from .models import InvitationCode, PasswordResetLink, User


def consume_invitation_code(code: str) -> InvitationCode:
    """Validates and marks one use of a code, inside the caller's transaction.

    select_for_update() locks the row for the rest of the transaction, so two
    concurrent registrations racing on the same single-use code can't both
    pass the is_valid() check before either commits.
    """
    try:
        invitation = InvitationCode.objects.select_for_update().get(code=code)
    except InvitationCode.DoesNotExist as exc:
        raise ValidationError({"invitation_code": "Invalid invitation code."}) from exc

    if not invitation.is_valid():
        raise ValidationError({"invitation_code": "This invitation code is no longer valid."})

    invitation.uses_count += 1
    invitation.save(update_fields=["uses_count"])
    return invitation


@transaction.atomic
def register_user(
    *,
    email: str,
    password: str,
    invitation_code: str,
    first_name: str = "",
    last_name: str = "",
    username: str | None = None,
    request=None,
) -> User:
    """Create a user and assign the default self-registration role (Guest).

    Business logic for registration lives here (not the view) since it spans
    two apps (accounts + rbac) and writes an audit entry. Wrapped in a
    transaction together with consume_invitation_code() so a user is never
    created without successfully consuming a valid code, or vice versa.
    """
    invitation = consume_invitation_code(invitation_code)

    user = User.objects.create_user(
        email=email,
        password=password,
        organization=invitation.organization,
        first_name=first_name,
        last_name=last_name,
        username=username,
    )

    guest_role = Role.objects.filter(organization=invitation.organization, name="Guest").first()
    if guest_role:
        guest_role.user_roles.create(user=user)

    log_action(
        actor=None,
        action="user.register",
        target=user,
        metadata={"invitation_code": invitation.code},
        request=request,
        organization=invitation.organization,
    )
    return user


def update_own_profile(*, actor: User, request=None, **fields) -> User:
    """A user editing their own account page - no permission check needed
    beyond authentication, since actor and target are always the same user."""
    for field, value in fields.items():
        setattr(actor, field, value)
    actor.save(update_fields=[*fields.keys()])
    confirm_stored_files(*fields.values())
    log_action(actor=actor, action="user.update_profile", target=actor, request=request)
    return actor


def create_invitation_code(
    *, created_by: User, max_uses: int = 1, expires_at=None, request=None
) -> InvitationCode:
    invitation = InvitationCode.objects.create(
        organization=created_by.organization, created_by=created_by, max_uses=max_uses, expires_at=expires_at
    )
    log_action(actor=created_by, action="invitation.create", target=invitation, request=request)
    return invitation


def revoke_invitation_code(*, invitation: InvitationCode, actor: User, request=None) -> InvitationCode:
    if invitation.revoked_at is None:
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=["revoked_at"])
    log_action(actor=actor, action="invitation.revoke", target=invitation, request=request)
    return invitation


# --- One-time password reset links -------------------------------------------

PASSWORD_RESET_LINK_LIFETIME = datetime.timedelta(hours=24)


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_password_reset_link(*, user: User, actor: User, request=None) -> tuple[PasswordResetLink, str]:
    """Generates a one-time reset link for `user` (same org as `actor` - the
    view enforces that) and returns (link, raw_token). The raw token is never
    stored, only its hash - the caller must hand it to the admin right away.
    Any earlier unused link for the same user stops working.

    An actor can only reset someone who holds no permission the actor lacks:
    resetting a password is a full account takeover, so without this a
    user.manage holder could take over an org admin's account."""
    if user.id == actor.id:
        raise PermissionDenied("Use your own account settings to change your password, not a reset link.")
    if not user.is_active:
        raise ValidationError("This user is blocked - unblock them before generating a reset link.")
    if user.is_superuser and not actor.is_superuser:
        raise PermissionDenied("You can't reset the password of a user with more access than you.")
    if not set(user.permission_codenames()) <= set(actor.permission_codenames()):
        raise PermissionDenied("You can't reset the password of a user with more access than you.")

    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        PasswordResetLink.objects.filter(user=user, used_at__isnull=True, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )
        link = PasswordResetLink.objects.create(
            organization=user.organization,
            user=user,
            token_hash=_hash_reset_token(token),
            created_by=actor,
            expires_at=timezone.now() + PASSWORD_RESET_LINK_LIFETIME,
        )
        log_action(actor=actor, action="user.password_reset_link.create", target=user, request=request)
    return link, token


def get_valid_password_reset_link(token: str) -> PasswordResetLink | None:
    """The link for `token` if it's still usable (unused, not revoked, not
    expired, and its user not blocked) - else None. Callers must give every
    None the same response, so a guessed/expired/used token is
    indistinguishable from one that never existed."""
    link = (
        PasswordResetLink.objects.select_related("user")
        .filter(token_hash=_hash_reset_token(token))
        .first()
    )
    if link is None or not link.is_valid() or not link.user.is_active:
        return None
    return link


def reset_password_with_link(*, link: PasswordResetLink, password: str, request=None) -> User:
    """Sets the new password, burns the link (and any other open link for
    the same user), and logs the user out everywhere by blacklisting every
    outstanding refresh token - whoever had the old password shouldn't keep
    a live session. Password strength is checked by the caller's serializer."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    user = link.user
    with transaction.atomic():
        # Re-read under a row lock so two simultaneous submissions of the
        # same link can't both succeed.
        link = PasswordResetLink.objects.select_for_update().get(pk=link.pk)
        if not link.is_valid():
            raise ValidationError("This reset link is no longer valid.")
        now = timezone.now()
        link.used_at = now
        link.save(update_fields=["used_at", "updated_at"])
        PasswordResetLink.objects.filter(user=user, used_at__isnull=True, revoked_at__isnull=True).update(
            revoked_at=now
        )
        user.set_password(password)
        user.save(update_fields=["password"])
        for outstanding in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=outstanding)
        log_action(actor=user, action="user.password_reset", target=user, request=request)
    return user
