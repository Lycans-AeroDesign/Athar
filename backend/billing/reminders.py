"""Renewal reminder emails to each organization's admins: 30, 7 and 1 days before access ends,
when it ends (grace period starts) and when the org goes read-only. Each one is sent once per
period - Subscription.last_reminder records the last one, keyed by the period's end date, so
recording a payment (which moves the end date) starts the sequence over."""

import logging
import math
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from accounts.models import User
from organization.models import OrganizationSettings
from platform_admin.models import PlatformSettings, subscriptions_enabled

from .models import Subscription
from .services import Access, Status, evaluate

logger = logging.getLogger(__name__)

REMINDER_DAYS = (1, 7, 30)

STRINGS = {
    "en": {
        "subject_due": "{org}: your Athar subscription ends in {days} day(s)",
        "subject_ended": "{org}: your Athar subscription has ended",
        "subject_read_only": "{org}: your Athar workspace is now read-only",
        "body_due": "The {org} subscription ends on {date}. Renew it to keep full access.",
        "body_ended": (
            "The {org} subscription ended on {date}. Everything keeps working until {read_only_date}; "
            "after that the workspace becomes read-only until it's renewed."
        ),
        "body_read_only": (
            "The {org} subscription has expired, so the workspace is read-only: members can still read "
            "and export everything, but can't add or change anything until it's renewed."
        ),
        "how_to_pay": "How to renew:",
        "link": "Subscription details:",
    },
    "ar": {
        "subject_due": "{org}: ينتهي اشتراكك في أثر خلال {days} يوم",
        "subject_ended": "{org}: انتهى اشتراكك في أثر",
        "subject_read_only": "{org}: أصبحت مساحة العمل في أثر للقراءة فقط",
        "body_due": "ينتهي اشتراك {org} في {date}. جدّد الاشتراك للحفاظ على الوصول الكامل.",
        "body_ended": (
            "انتهى اشتراك {org} في {date}. سيستمر كل شيء في العمل حتى {read_only_date}، "
            "وبعدها تصبح مساحة العمل للقراءة فقط حتى يتم التجديد."
        ),
        "body_read_only": (
            "انتهى اشتراك {org}، لذا أصبحت مساحة العمل للقراءة فقط: يمكن للأعضاء قراءة كل شيء وتصديره، "
            "لكن لا يمكن إضافة أو تعديل أي شيء حتى يتم التجديد."
        ),
        "how_to_pay": "طريقة التجديد:",
        "link": "تفاصيل الاشتراك:",
    },
}


def reminder_stage(access: Access, now) -> str | None:
    """Which reminder applies right now: "30"/"7"/"1" (the smallest threshold already reached),
    "ended", "read_only", or None."""
    if access.access_until is None:
        return None
    if access.status in (Status.ACTIVE, Status.TRIALING):
        days_left = math.ceil((access.access_until - now) / timedelta(days=1))
        return next((str(days) for days in REMINDER_DAYS if days_left <= days), None)
    if access.status == Status.GRACE:
        return "ended"
    if access.status == Status.EXPIRED:
        return "read_only"
    return None


def _app_link() -> str:
    origins = settings.CORS_ALLOWED_ORIGINS
    return f"{origins[0].rstrip('/')}/en/settings/subscription" if origins else ""


def _message(stage: str, access: Access, now, org_name: str, payment_instructions: str) -> tuple[str, str]:
    """Subject and plain-text body, English then Arabic (the language isn't stored per user)."""
    access_until = access.access_until
    assert access_until is not None  # only called once reminder_stage() found a stage
    parts, subjects = [], []
    for language in ("en", "ar"):
        strings = STRINGS[language]
        values = {
            "org": org_name,
            "days": max(math.ceil((access_until - now) / timedelta(days=1)), 0),
            "date": access_until.date().isoformat(),
            "read_only_date": access.read_only_from.date().isoformat() if access.read_only_from else "",
        }
        key = "due" if stage.isdigit() else stage
        subjects.append(strings[f"subject_{key}"].format(**values))
        lines = [strings[f"body_{key}"].format(**values)]
        if payment_instructions:
            lines += ["", strings["how_to_pay"], payment_instructions]
        if _app_link():
            lines += ["", f"{strings['link']} {_app_link()}"]
        parts.append("\n".join(lines))
    return subjects[0], "\n\n----------\n\n".join(parts)


def send_due_reminders(now=None) -> int:
    """Returns how many organizations were emailed."""
    if not settings.EMAIL_ENABLED or not subscriptions_enabled():
        return 0
    now = now or timezone.now()
    instructions = PlatformSettings.load().subscription_payment_instructions
    sent = 0
    subscriptions = Subscription.objects.filter(exempt=False, organization__is_active=True).select_related(
        "organization"
    )
    for subscription in subscriptions:
        access = evaluate(subscription, now)
        stage = reminder_stage(access, now)
        if stage is None or access.access_until is None:  # the second is implied by the first
            continue
        key = f"{access.access_until.isoformat()}|{stage}"
        if subscription.last_reminder == key:
            continue
        recipients = list(
            User.objects.filter(
                organization=subscription.organization, is_active=True, roles__name="Organization Admin"
            )
            .values_list("email", flat=True)
            .distinct()
        )
        if recipients:
            org_name = OrganizationSettings.load(subscription.organization).name
            subject, body = _message(stage, access, now, org_name, instructions)
            try:
                send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients)
            except Exception:
                logger.exception(
                    "Failed to send subscription reminder for organization %s", subscription.organization_id
                )
                continue
            sent += 1
        subscription.last_reminder = key
        subscription.save(update_fields=["last_reminder", "updated_at"])
    return sent
