from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from accounts.models import InvitationCode, User
from audit.models import AuditLog
from core.testing import RoleLoginMixin, create_test_organization
from organization.services import create_organization
from platform_admin.models import PlatformSettings
from rbac.models import Role

from .models import Payment, Subscription
from .reminders import send_due_reminders
from .services import Status, check_storage_limit, check_user_limit, evaluate, record_payment


def _enable_subscriptions(enabled=True):
    row = PlatformSettings.load()
    row.subscriptions_enabled = enabled
    row.save()


@override_settings(SUBSCRIPTION_GRACE_DAYS=14, SUBSCRIPTION_RENEWAL_NOTICE_DAYS=30)
class EvaluateTests(TestCase):
    now = datetime(2027, 6, 1, tzinfo=dt_timezone.utc)

    def _sub(self, **fields):
        return Subscription(**fields)

    def test_missing_or_exempt_is_exempt(self):
        self.assertEqual(evaluate(None, self.now).status, Status.EXEMPT)
        self.assertEqual(evaluate(self._sub(exempt=True), self.now).status, Status.EXEMPT)

    def test_no_dates_is_expired(self):
        self.assertTrue(evaluate(self._sub(), self.now).expired)

    def test_trial_then_grace_then_expired(self):
        sub = self._sub(trial_ends_at=self.now + timedelta(days=5))
        access = evaluate(sub, self.now)
        self.assertEqual(access.status, Status.TRIALING)
        self.assertTrue(access.renewal_due)
        self.assertEqual(evaluate(sub, self.now + timedelta(days=10)).status, Status.GRACE)
        self.assertEqual(evaluate(sub, self.now + timedelta(days=19)).status, Status.EXPIRED)

    def test_paid_is_active_and_renewal_due_only_near_the_end(self):
        sub = self._sub(paid_until=self.now + timedelta(days=200), trial_ends_at=self.now - timedelta(days=1))
        access = evaluate(sub, self.now)
        self.assertEqual(access.status, Status.ACTIVE)
        self.assertFalse(access.renewal_due)
        self.assertEqual(access.read_only_from, sub.paid_until + timedelta(days=14))
        self.assertTrue(evaluate(sub, self.now + timedelta(days=171)).renewal_due)


class RecordPaymentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()
        cls.actor = User.objects.create_user(
            email="op@x.example", password="password123", organization=cls.organization
        )

    def _pay(self):
        return record_payment(
            organization=self.organization,
            amount=Decimal("100"),
            currency="usd",
            paid_on=timezone.now().date(),
            actor=self.actor,
        )

    def test_payment_after_expiry_starts_now_and_clears_exempt(self):
        Subscription.objects.create(
            organization=self.organization, exempt=True, paid_until=timezone.now() - timedelta(days=90)
        )
        before = timezone.now()
        payment = self._pay()
        self.assertGreaterEqual(payment.period_start, before)
        self.assertEqual(payment.currency, "USD")
        subscription = Subscription.objects.get(organization=self.organization)
        self.assertFalse(subscription.exempt)
        self.assertEqual(subscription.paid_until, payment.period_end)
        self.assertEqual(evaluate(subscription).status, Status.ACTIVE)
        self.assertTrue(AuditLog.objects.filter(action="platform.subscription.payment").exists())

    def test_paying_early_extends_from_the_current_end(self):
        trial_end = timezone.now() + timedelta(days=10)
        Subscription.objects.create(organization=self.organization, trial_ends_at=trial_end)
        first = self._pay()
        self.assertEqual(first.period_start, trial_end)
        second = self._pay()
        self.assertEqual(second.period_start, first.period_end)
        self.assertEqual(second.period_end.year, trial_end.year + 2)


class NewOrganizationTests(TestCase):
    def _create(self, email):
        organization, _ = create_organization(
            name=f"Org {email}", admin_email=email, admin_password="somepassword123", admin_username=email.split("@")[0]
        )
        return organization.subscription

    @override_settings(SUBSCRIPTIONS_ENABLED=False)
    def test_new_org_is_exempt_while_billing_is_off(self):
        self.assertTrue(self._create("a@new.example").exempt)

    @override_settings(SUBSCRIPTIONS_ENABLED=True, SUBSCRIPTION_TRIAL_DAYS=14)
    def test_new_org_gets_a_trial_while_billing_is_on(self):
        subscription = self._create("b@new.example")
        self.assertFalse(subscription.exempt)
        self.assertAlmostEqual(
            subscription.trial_ends_at, timezone.now() + timedelta(days=14), delta=timedelta(minutes=1)
        )
        self.assertEqual(evaluate(subscription).status, Status.TRIALING)


class EnforcementTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def setUp(self):
        _, token = self._login_with_role("member@x.example", "Member")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def _expire(self):
        Subscription.objects.update_or_create(
            organization=self.organization,
            defaults={"exempt": False, "trial_ends_at": None, "paid_until": timezone.now() - timedelta(days=30)},
        )

    def _write(self):
        return self.client.patch(reverse("auth-me"), {"first_name": "Changed"}, format="json", **self.auth)

    def test_expired_org_can_write_while_billing_is_off(self):
        self._expire()
        _enable_subscriptions(False)
        self.assertEqual(self._write().status_code, status.HTTP_200_OK)

    def test_expired_org_is_read_only_while_billing_is_on(self):
        self._expire()
        _enable_subscriptions()
        response = self._write()
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "subscription_expired")
        self.assertEqual(self.client.get(reverse("auth-me"), **self.auth).status_code, status.HTTP_200_OK)
        status_response = self.client.get(reverse("billing-subscription"), **self.auth)
        self.assertEqual(status_response.data["status"], "expired")
        self.assertTrue(status_response.data["read_only"])
        self.assertNotEqual(
            self.client.post(reverse("auth-logout"), **self.auth).status_code, status.HTTP_403_FORBIDDEN
        )

    def _register(self, code):
        return self.client.post(
            reverse("auth-register"),
            {
                "email": "late@x.example",
                "password": "somepassword123",
                "invitation_code": code.code,
                "username": "late",
            },
            format="json",
        )

    def test_expired_org_refuses_registration_and_new_codes(self):
        code = InvitationCode.objects.create(organization=self.organization, max_uses=1)
        self._expire()
        _enable_subscriptions()

        response = self._register(code)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("invitation_code", response.data)
        self.assertFalse(User.objects.filter(email="late@x.example").exists())
        code.refresh_from_db()
        self.assertEqual(code.uses_count, 0)  # the refused attempt doesn't burn the code

        _, admin_token = self._login_with_role("admin@x.example", "Organization Admin")
        response = self.client.post(
            reverse("auth-invitation-list-create"),
            {"max_uses": 1},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "subscription_expired")

    def test_expired_org_still_registers_while_billing_is_off(self):
        code = InvitationCode.objects.create(organization=self.organization, max_uses=1)
        self._expire()
        _enable_subscriptions(False)
        self.assertEqual(self._register(code).status_code, status.HTTP_201_CREATED)

    def test_grace_period_still_allows_writes(self):
        Subscription.objects.update_or_create(
            organization=self.organization,
            defaults={"exempt": False, "paid_until": timezone.now() - timedelta(days=3)},
        )
        _enable_subscriptions()
        self.assertEqual(self._write().status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("billing-subscription"), **self.auth)
        self.assertEqual(response.data["status"], "grace")
        self.assertFalse(response.data["read_only"])

    def test_org_without_a_subscription_row_is_exempt(self):
        _enable_subscriptions()
        Subscription.objects.filter(organization=self.organization).delete()
        self.assertEqual(self._write().status_code, status.HTTP_200_OK)


class PlatformSubscriptionApiTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization("Operator Org")
        cls.tenant = create_test_organization("Tenant")

    def _operator(self):
        user, token = self._login_with_role("op@a.example", "Organization Admin")
        user.is_superuser = True
        user.save(update_fields=["is_superuser"])
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_settings_toggle_and_price(self):
        headers = self._operator()
        response = self.client.patch(
            reverse("platform-settings"),
            {"subscriptions_enabled": True, "subscription_price": "120.00", "subscription_currency": "egp"},
            format="json",
            **headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["subscriptions_enabled"])
        self.assertEqual(response.data["subscription_currency"], "EGP")
        # Fields not sent are left alone.
        self.assertIn("organization_registration_enabled", response.data)
        self.assertTrue(AuditLog.objects.filter(action="platform.settings.subscriptions").exists())
        empty = self.client.patch(reverse("platform-settings"), {}, format="json", **headers)
        self.assertEqual(empty.status_code, status.HTTP_400_BAD_REQUEST)

    def test_record_payment_and_adjust(self):
        headers = self._operator()
        url = reverse("platform-organization-payments", kwargs={"pk": self.tenant.pk})
        response = self.client.post(
            url,
            {"amount": "120.00", "currency": "USD", "paid_on": "2026-11-18", "reference": "TX-1"},
            format="json",
            **headers,
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], "active")
        self.assertEqual(len(response.data["payments"]), 1)
        self.assertEqual(Payment.objects.filter(subscription__organization=self.tenant).count(), 1)

        detail = reverse("platform-organization-subscription", kwargs={"pk": self.tenant.pk})
        response = self.client.patch(detail, {"exempt": True, "notes": "Sponsor"}, format="json", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "exempt")

        listing = self.client.get(reverse("platform-organization-detail", kwargs={"pk": self.tenant.pk}), **headers)
        self.assertEqual(listing.data["subscription"]["status"], "exempt")

    def test_superuser_bypasses_read_only(self):
        headers = self._operator()
        _enable_subscriptions()
        Subscription.objects.update_or_create(
            organization=self.organization,
            defaults={"exempt": False, "paid_until": timezone.now() - timedelta(days=60)},
        )
        response = self.client.patch(reverse("auth-me"), {"first_name": "Op"}, format="json", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_org_admin_cannot_use_platform_billing_endpoints(self):
        _, token = self._login_with_role("admin@a.example", "Organization Admin")
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        for name, method in (
            ("platform-organization-subscription", "get"),
            ("platform-organization-subscription", "patch"),
            ("platform-organization-payments", "post"),
        ):
            url = reverse(name, kwargs={"pk": self.organization.pk})
            response = getattr(self.client, method)(url, {"exempt": True}, format="json", **headers)
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, name)


class LimitTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()
        User.objects.create_user(email="one@x.example", password="password123", organization=cls.organization)
        cls.subscription = Subscription.objects.create(
            organization=cls.organization,
            paid_until=timezone.now() + timedelta(days=100),
            max_users=1,
            max_storage_gb=1,
        )

    def test_user_limit_applies_only_while_billing_is_on(self):
        _enable_subscriptions(False)
        check_user_limit(self.organization)
        check_storage_limit(self.organization, 5 * 1024**3)
        _enable_subscriptions()
        with self.assertRaises(ValidationError):
            check_user_limit(self.organization)
        with self.assertRaises(ValidationError):
            check_storage_limit(self.organization, 2 * 1024**3)
        check_storage_limit(self.organization, 1024)

    def test_exempt_orgs_have_no_limits(self):
        _enable_subscriptions()
        Subscription.objects.filter(pk=self.subscription.pk).update(exempt=True)
        check_user_limit(self.organization)


@override_settings(EMAIL_ENABLED=True, CORS_ALLOWED_ORIGINS=["https://app.example"])
class ReminderTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization("Reminder Org")

    def setUp(self):
        _enable_subscriptions()
        admin = User.objects.create_user(email="boss@x.example", password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name="Organization Admin").user_roles.create(user=admin)

    def test_each_reminder_is_sent_once_and_restarts_after_payment(self):
        now = timezone.now()
        subscription = Subscription.objects.create(organization=self.organization, paid_until=now + timedelta(days=6))
        self.assertEqual(send_due_reminders(now), 1)
        self.assertEqual(mail.outbox[-1].to, ["boss@x.example"])
        self.assertIn("https://app.example/en/settings/subscription", mail.outbox[-1].body)
        self.assertEqual(send_due_reminders(now), 0)  # same stage, already sent
        self.assertEqual(send_due_reminders(now + timedelta(days=5, hours=12)), 1)  # 1-day reminder
        self.assertEqual(send_due_reminders(now + timedelta(days=7)), 1)  # ended (grace)
        self.assertEqual(send_due_reminders(now + timedelta(days=30)), 1)  # read-only
        self.assertEqual(send_due_reminders(now + timedelta(days=31)), 0)
        subscription.refresh_from_db()
        subscription.paid_until = now + timedelta(days=200)
        subscription.save()
        self.assertEqual(send_due_reminders(now + timedelta(days=31)), 0)  # 169 days left: nothing due
        self.assertEqual(len(mail.outbox), 4)

    def test_nothing_is_sent_while_billing_is_off(self):
        _enable_subscriptions(False)
        Subscription.objects.create(organization=self.organization, paid_until=timezone.now() + timedelta(days=1))
        self.assertEqual(send_due_reminders(), 0)
