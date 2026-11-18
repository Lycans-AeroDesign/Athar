"""Subscription status, enforcement and the platform-admin actions on it."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from audit.services import log_action
from platform_admin.models import subscriptions_enabled

from .models import Payment, Subscription


class Status:
    EXEMPT = "exempt"
    TRIALING = "trialing"
    ACTIVE = "active"
    GRACE = "grace"
    EXPIRED = "expired"

    choices = [EXEMPT, TRIALING, ACTIVE, GRACE, EXPIRED]


@dataclass(frozen=True)
class Access:
    status: str
    # End of the paid/trial period, and when read-only mode starts (end + grace period).
    access_until: datetime | None = None
    read_only_from: datetime | None = None
    renewal_due: bool = False

    @property
    def expired(self) -> bool:
        return self.status == Status.EXPIRED


def _add_years(moment: datetime, years: int) -> datetime:
    try:
        return moment.replace(year=moment.year + years)
    except ValueError:  # Feb 29 in a non-leap target year
        return moment.replace(year=moment.year + years, day=28)


def subscription_of(organization) -> Subscription | None:
    """The org's Subscription, or None - treated as exempt, like an org that predates billing."""
    try:
        return organization.subscription
    except Subscription.DoesNotExist:
        return None


def evaluate(subscription: Subscription | None, now: datetime | None = None) -> Access:
    if subscription is None or subscription.exempt:
        return Access(Status.EXEMPT)
    now = now or timezone.now()
    ends = max((d for d in (subscription.paid_until, subscription.trial_ends_at) if d), default=None)
    if ends is None:
        return Access(Status.EXPIRED, renewal_due=True)
    read_only_from = ends + timedelta(days=settings.SUBSCRIPTION_GRACE_DAYS)
    if now < ends:
        status = Status.ACTIVE if subscription.paid_until == ends else Status.TRIALING
        renewal_due = ends - now <= timedelta(days=settings.SUBSCRIPTION_RENEWAL_NOTICE_DAYS)
        return Access(status, ends, read_only_from, renewal_due)
    if now < read_only_from:
        return Access(Status.GRACE, ends, read_only_from, True)
    return Access(Status.EXPIRED, ends, read_only_from, True)


def is_read_only(organization) -> bool:
    """Whether this org's members are blocked from writing. Checks the dates first so the
    common (paid-up) case costs no query for the platform switch."""
    return evaluate(subscription_of(organization)).expired and subscriptions_enabled()


GB = 1024**3


def usage(organization) -> dict:
    """Current counts the subscription limits apply to."""
    from accounts.models import User
    from files.models import StoredFile

    return {
        "user_count": User.objects.filter(organization=organization, is_active=True).count(),
        "storage_bytes": StoredFile.objects.filter(organization=organization).aggregate(total=Sum("size"))["total"]
        or 0,
    }


def _limits(organization) -> Subscription | None:
    """The org's subscription when a limit could apply (billing on, not exempt), else None."""
    subscription = Subscription.objects.filter(organization=organization).first()
    if subscription is None or subscription.exempt or not subscriptions_enabled():
        return None
    return subscription


def check_user_limit(organization) -> None:
    """Raises ValidationError if adding one more active member would exceed max_users."""
    subscription = _limits(organization)
    if subscription is None or subscription.max_users is None:
        return
    if usage(organization)["user_count"] >= subscription.max_users:
        raise ValidationError(
            f"This organization has reached its limit of {subscription.max_users} members. "
            "Ask an organization admin to contact the platform administrator."
        )


def check_storage_limit(organization, incoming_bytes: int) -> None:
    """Raises ValidationError if storing `incoming_bytes` more would exceed max_storage_gb."""
    subscription = _limits(organization)
    if subscription is None or subscription.max_storage_gb is None:
        return
    if usage(organization)["storage_bytes"] + incoming_bytes > subscription.max_storage_gb * GB:
        raise ValidationError(
            f"This organization has used its {subscription.max_storage_gb} GB of storage. "
            "Delete some files or ask an organization admin to contact the platform administrator."
        )


def create_for_new_organization(organization) -> Subscription:
    """New signups get a trial while billing is on. While it's off they're exempt, so turning
    billing on later never locks out orgs created back when nobody was being charged."""
    if subscriptions_enabled():
        trial_ends_at = timezone.now() + timedelta(days=settings.SUBSCRIPTION_TRIAL_DAYS)
        return Subscription.objects.create(organization=organization, trial_ends_at=trial_ends_at)
    return Subscription.objects.create(organization=organization, exempt=True)


def _locked_subscription(organization) -> Subscription:
    Subscription.objects.get_or_create(organization=organization, defaults={"exempt": True})
    return Subscription.objects.select_for_update().get(organization=organization)


@transaction.atomic
def update_subscription(*, organization, changes: dict, actor, request=None) -> Subscription:
    """Manual adjustment by a platform admin: any of exempt, trial_ends_at, paid_until, notes,
    max_users, max_storage_gb."""
    subscription = _locked_subscription(organization)
    for field, value in changes.items():
        setattr(subscription, field, value)
    subscription.save()
    log_action(
        actor=actor,
        action="platform.subscription.update",
        target=organization,
        metadata={key: None if value is None else str(value) for key, value in changes.items() if key != "notes"},
        request=request,
        organization=organization,
    )
    return subscription


@transaction.atomic
def record_payment(
    *, organization, amount, currency: str, paid_on, reference: str = "", notes: str = "", actor, request=None
) -> Payment:
    """Adds one year of access, starting where the current paid period or trial ends if that's
    still ahead (paying early never loses days), otherwise from now. Clears `exempt`."""
    subscription = _locked_subscription(organization)
    now = timezone.now()
    start = max(d for d in (now, subscription.paid_until, subscription.trial_ends_at) if d)
    end = _add_years(start, 1)
    subscription.paid_until = end
    subscription.exempt = False
    subscription.save(update_fields=["paid_until", "exempt", "updated_at"])
    payment = Payment.objects.create(
        subscription=subscription,
        amount=amount,
        currency=currency.upper(),
        paid_on=paid_on,
        period_start=start,
        period_end=end,
        reference=reference,
        notes=notes,
        recorded_by=actor,
    )
    log_action(
        actor=actor,
        action="platform.subscription.payment",
        target=organization,
        metadata={"amount": str(amount), "currency": payment.currency, "period_end": end.isoformat()},
        request=request,
        organization=organization,
    )
    return payment
