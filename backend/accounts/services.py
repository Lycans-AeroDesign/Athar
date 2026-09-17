from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from files.services import confirm_stored_files
from rbac.models import Role

from .models import InvitationCode, User


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
