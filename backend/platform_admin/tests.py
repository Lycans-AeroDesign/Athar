from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import User
from audit.models import AuditLog
from core.testing import RoleLoginMixin, create_test_organization
from files.models import StoredFile


class PlatformAdminTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization("Operator Org")
        cls.other = create_test_organization("Tenant B")
        cls.other_member = User.objects.create_user(
            email="member@b.example", password="password123", organization=cls.other
        )
        StoredFile.objects.create(
            organization=cls.other, size=2048, original_filename="secret.pdf", content_type="application/pdf"
        )

    def _operator(self):
        user, token = self._login_with_role("op@a.example", "Organization Admin")
        user.is_superuser = True
        user.save(update_fields=["is_superuser"])
        return user, {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_non_superuser_is_forbidden_everywhere(self):
        _, token = self._login_with_role("admin@a.example", "Organization Admin")
        headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        for name, kwargs in [
            ("platform-summary", {}),
            ("platform-organization-list", {}),
            ("platform-organization-detail", {"pk": self.other.pk}),
            ("platform-organization-users", {"pk": self.other.pk}),
        ]:
            self.assertEqual(self.client.get(reverse(name, kwargs=kwargs), **headers).status_code, 403, name)
        for name in ("platform-user-active", "platform-user-password-reset-link"):
            url = reverse(name, kwargs={"pk": self.other_member.pk})
            self.assertEqual(self.client.post(url, {}, format="json", **headers).status_code, 403, name)
        url = reverse("platform-organization-active", kwargs={"pk": self.other.pk})
        self.assertEqual(self.client.post(url, {"is_active": False}, format="json", **headers).status_code, 403)

    def test_list_shows_stats_across_orgs_without_content(self):
        _, headers = self._operator()

        response = self.client.get(reverse("platform-organization-list"), **headers)

        self.assertEqual(response.status_code, 200)
        rows = {row["name"]: row for row in response.data["results"]}
        self.assertEqual(rows["Tenant B"]["user_count"], 1)
        self.assertEqual(rows["Tenant B"]["file_bytes"], 2048)
        self.assertNotIn("secret.pdf", str(response.data))

    def test_users_list_is_metadata_only(self):
        _, headers = self._operator()

        response = self.client.get(reverse("platform-organization-users", kwargs={"pk": self.other.pk}), **headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual([u["email"] for u in response.data["results"]], ["member@b.example"])
        self.assertNotIn("preferences", response.data["results"][0])
        self.assertNotIn("password", response.data["results"][0])

    def test_summary_totals(self):
        _, headers = self._operator()

        response = self.client.get(reverse("platform-summary"), **headers)

        self.assertEqual(response.data["organization_count"] >= 2, True)
        self.assertEqual(response.data["file_bytes"], 2048)

    def test_suspended_org_users_are_locked_out_and_audit_logged(self):
        operator, headers = self._operator()
        _, member_token = self._login_with_role("m@b2.example", "Member", organization=self.other)

        url = reverse("platform-organization-active", kwargs={"pk": self.other.pk})
        self.assertEqual(self.client.post(url, {"is_active": False}, format="json", **headers).status_code, 200)

        me = self.client.get(reverse("auth-me"), HTTP_AUTHORIZATION=f"Bearer {member_token}")
        self.assertEqual(me.status_code, 403)
        login = self.client.post(
            reverse("auth-login"), {"email": "m@b2.example", "password": "password123"}, format="json"
        )
        self.assertEqual(login.status_code, 401)
        self.assertTrue(AuditLog.objects.filter(action="platform.organization.suspend", organization=self.other).exists())

        self.client.post(url, {"is_active": True}, format="json", **headers)
        login = self.client.post(
            reverse("auth-login"), {"email": "m@b2.example", "password": "password123"}, format="json"
        )
        self.assertEqual(login.status_code, 200)

    def test_cannot_suspend_own_organization(self):
        operator, headers = self._operator()

        url = reverse("platform-organization-active", kwargs={"pk": operator.organization_id})

        self.assertEqual(self.client.post(url, {"is_active": False}, format="json", **headers).status_code, 403)

    def test_block_user_and_reset_link_are_audit_logged(self):
        _, headers = self._operator()

        url = reverse("platform-user-active", kwargs={"pk": self.other_member.pk})
        self.assertEqual(self.client.post(url, {"is_active": False}, format="json", **headers).status_code, 200)
        self.other_member.refresh_from_db()
        self.assertFalse(self.other_member.is_active)
        self.client.post(url, {"is_active": True}, format="json", **headers)

        reset = self.client.post(
            reverse("platform-user-password-reset-link", kwargs={"pk": self.other_member.pk}),
            {},
            format="json",
            **headers,
        )
        self.assertEqual(reset.status_code, 201)
        self.assertIn("token", reset.data)
        actions = set(AuditLog.objects.filter(organization=self.other).values_list("action", flat=True))
        self.assertTrue({"platform.user.block", "platform.user.password_reset_link"} <= actions)

    def test_suspended_org_cannot_refresh_and_org_admin_cannot_block_operator(self):
        operator, headers = self._operator()
        other_admin, other_token = self._login_with_role("oa@b.example", "Organization Admin", organization=self.other)
        login = self.client.post(reverse("auth-login"), {"email": "oa@b.example", "password": "password123"}, format="json")
        self.assertEqual(login.status_code, 200)

        self.client.post(
            reverse("platform-organization-active", kwargs={"pk": self.other.pk}), {"is_active": False}, format="json", **headers
        )
        self.assertEqual(self.client.post(reverse("auth-refresh")).status_code, 401)

        self.client.post(
            reverse("platform-organization-active", kwargs={"pk": self.other.pk}), {"is_active": True}, format="json", **headers
        )
        other_operator = User.objects.create_user(
            email="op2@b.example", password="password123", organization=self.other, is_superuser=True
        )
        response = self.client.post(
            reverse("rbac-user-active", kwargs={"pk": other_operator.pk}),
            {"is_active": False},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {other_token}",
        )
        self.assertEqual(response.status_code, 403)
