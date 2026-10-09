import datetime
import hashlib
import logging
import secrets
from urllib.parse import urlsplit

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.services import log_action
from files.services import confirm_stored_files
from rbac.models import Role

from .models import InvitationCode, PasswordResetLink, User

logger = logging.getLogger(__name__)


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

    with transaction.atomic():
        link, token = _issue_password_reset_link(user=user, created_by=actor)
        log_action(actor=actor, action="user.password_reset_link.create", target=user, request=request)
    return link, token


def _issue_password_reset_link(*, user: User, created_by: User | None) -> tuple[PasswordResetLink, str]:
    """Revokes the user's earlier unused links and creates a fresh one -
    call inside a transaction. `created_by` is None for a self-service
    request from the login page."""
    token = secrets.token_urlsafe(32)
    PasswordResetLink.objects.filter(user=user, used_at__isnull=True, revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )
    link = PasswordResetLink.objects.create(
        organization=user.organization,
        user=user,
        token_hash=_hash_reset_token(token),
        created_by=created_by,
        expires_at=timezone.now() + PASSWORD_RESET_LINK_LIFETIME,
    )
    return link, token


# A self-service request is ignored while the user already got a link this
# recently - otherwise anyone could flood an inbox (the per-IP "auth"
# throttle alone doesn't stop a distributed attempt) or keep revoking the
# link the real user is about to click.
SELF_SERVICE_RESET_COOLDOWN = datetime.timedelta(minutes=2)


def request_password_reset(*, email: str, link_base: str, language: str) -> bool:
    """Self-service "forgot password": if `email` belongs to an active user,
    issues a fresh link and emails it. Runs in a Celery task (see
    accounts.tasks) so the API response - and its timing - is identical
    whether or not the account exists. Returns whether an email went out."""
    user = User.objects.select_related("organization").filter(email__iexact=email.strip(), is_active=True).first()
    if user is None:
        return False
    recent = PasswordResetLink.objects.filter(
        user=user, created_at__gte=timezone.now() - SELF_SERVICE_RESET_COOLDOWN
    ).exists()
    if recent:
        return False
    with transaction.atomic():
        _link, token = _issue_password_reset_link(user=user, created_by=None)
        log_action(
            actor=None,
            action="user.password_reset_link.self_request",
            target=user,
            organization=user.organization,
        )
    return send_password_reset_email(user=user, url=f"{link_base}#{token}", language=language, actor=None)


# Email copy per UI language - the backend has no gettext catalogue, and the
# frontend's next-intl messages aren't reachable from here.
PASSWORD_RESET_EMAIL_STRINGS = {
    "en": {
        "subject": "Reset your {org} password",
        "greeting": "Hi {name},",
        "intro": "An administrator of {org} created a link for you to set a new password.",
        "intro_self": "We received a request to reset the password of your {org} account.",
        "button": "Set a new password",
        "fallback": "If the button doesn't work, copy this link into your browser:",
        "expiry": "The link works once and expires in 24 hours. Using it signs you out of all your sessions.",
        "ignore": "If you weren't expecting this, you can ignore this email - your password stays the same.",
        "sent_by": "Sent by Athar",
    },
    "ar": {
        "subject": "إعادة تعيين كلمة المرور في {org}",
        "greeting": "مرحبًا {name}،",
        "intro": "أنشأ أحد مسؤولي {org} رابطًا لتعيين كلمة مرور جديدة لحسابك.",
        "intro_self": "تلقّينا طلبًا لإعادة تعيين كلمة مرور حسابك في {org}.",
        "button": "تعيين كلمة مرور جديدة",
        "fallback": "إذا لم يعمل الزر، انسخ هذا الرابط والصقه في المتصفح:",
        "expiry": "يعمل الرابط مرة واحدة وتنتهي صلاحيته خلال 24 ساعة، واستخدامه يسجّل خروجك من جميع جلساتك.",
        "ignore": "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها - ستبقى كلمة المرور كما هي.",
        "sent_by": "أُرسلت بواسطة أثر (Athar)",
    },
}


EMAIL_LOGO_CID = "org-logo"


class _EmailWithInlineImage(EmailMultiAlternatives):
    """EmailMultiAlternatives whose HTML part can carry one inline image,
    referenced from the HTML as `cid:<EMAIL_LOGO_CID>`. Embedded rather than
    linked: the logo URL is on the backend, which an email client often
    can't reach (localhost in dev, a private network when self-hosted), and
    many clients block remote images by default anyway. The image goes in a
    multipart/related around the HTML, so clients show it in the body rather
    than as an attachment."""

    inline_image: tuple[bytes, str] | None = None  # (data, "image/png")

    def message(self, **kwargs):
        msg = super().message(**kwargs)
        if self.inline_image:
            data, content_type = self.inline_image
            maintype, subtype = content_type.split("/")
            html = next(part for part in msg.walk() if part.get_content_type() == "text/html")
            html.add_related(
                data,
                maintype,
                subtype,
                cid=f"<{EMAIL_LOGO_CID}>",
                disposition="inline",
                filename=f"logo.{subtype}",
            )
        return msg


def _email_logo(org_settings) -> tuple[bytes, str] | None:
    """The org's logo as (bytes, content type) for embedding in an email, or
    None if there's no usable one. Only formats email clients render - same
    byte-sniffing as the public logo endpoint, minus .ico."""
    from organization.services import branding_image_content_type

    if not org_settings.logo:
        return None
    try:
        content_type = branding_image_content_type(org_settings.logo)
        if content_type is None or content_type == "image/x-icon":
            return None
        with org_settings.logo.file.open("rb") as handle:
            return handle.read(), content_type
    except OSError:
        logger.warning("Couldn't read logo for organization %s", org_settings.organization_id)
        return None


def send_password_reset_email(*, user: User, url: str, language: str, actor: User | None, request=None) -> bool:
    """Emails `url` (a freshly generated reset link) to `user`. Returns
    whether it went out - a failure is logged, not raised, since the link
    already exists and an admin can still copy it by hand. `actor` is the
    admin who generated it, or None for a self-service request."""
    from organization.models import OrganizationSettings

    org_settings = OrganizationSettings.load(user.organization)
    org_name = org_settings.name
    name = user.first_name or user.email
    raw = PASSWORD_RESET_EMAIL_STRINGS.get(language, PASSWORD_RESET_EMAIL_STRINGS["en"])
    strings = {key: value.format(org=org_name, name=name) for key, value in raw.items()}
    if actor is None:
        strings["intro"] = strings["intro_self"]
    logo = _email_logo(org_settings)
    context = {
        "strings": strings,
        "url": url,
        "org_name": org_name,
        "primary_color": org_settings.primary_color,
        "logo_cid": EMAIL_LOGO_CID if logo else None,
        # The app's own address (the reset link's origin - already checked
        # against CORS_ALLOWED_ORIGINS), for the "Sent by Athar" footer.
        "app_url": "{0.scheme}://{0.netloc}".format(urlsplit(url)),
        "language": language,
        "direction": "rtl" if language == "ar" else "ltr",
    }
    message = _EmailWithInlineImage(
        subject=strings["subject"],
        body=render_to_string("accounts/email/password_reset.txt", context),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    message.attach_alternative(render_to_string("accounts/email/password_reset.html", context), "text/html")
    message.inline_image = logo
    try:
        message.send()
    except Exception:
        logger.exception("Failed to send password reset email to user %s", user.id)
        return False
    log_action(
        actor=actor,
        action="user.password_reset_link.email",
        target=user,
        request=request,
        organization=user.organization,
    )
    return True


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
