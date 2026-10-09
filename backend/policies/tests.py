from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from core.testing import create_test_organization
from rbac.models import Role

from .models import PolicyAcceptance, PolicyVersion


class PolicyTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(reverse("auth-login"), {"email": email, "password": "password123"}, format="json")
        return user, {"HTTP_AUTHORIZATION": f"Bearer {response.data['access']}"}

    def setUp(self):
        self.admin, self.admin_auth = self._login("policy-admin@example.com", "Organization Admin")
        self.member, self.member_auth = self._login("policy-member@example.com", "Member")

    def _publish(self, kind="privacy", title="Privacy Policy", content="We keep your data private."):
        self.client.put(
            reverse("policies-draft", args=[kind]), {"title": title, "content": content}, format="json", **self.admin_auth
        )
        return self.client.post(reverse("policies-publish", args=[kind]), **self.admin_auth)

    def _accept_all(self, auth):
        current = self.client.get(reverse("policies-current"), **auth).data
        return self.client.post(
            reverse("policies-accept"), {"version_ids": [p["id"] for p in current]}, format="json", **auth
        )

    def test_no_published_policy_means_no_gate(self):
        self.assertEqual(self.client.get(reverse("auth-me"), **self.member_auth).status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("knowledge-article-list-create"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_draft_is_invisible_until_published(self):
        self.client.put(
            reverse("policies-draft", args=["privacy"]), {"title": "Draft", "content": "WIP"}, format="json", **self.admin_auth
        )
        self.assertEqual(self.client.get(reverse("policies-current"), **self.member_auth).data, [])
        response = self.client.get(reverse("knowledge-article-list-create"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_publish_gates_everyone_until_accepted_and_each_edit_regates(self):
        response = self._publish()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["version"], 1)

        # Blocked everywhere except the allowlist - including the publisher.
        for auth in (self.member_auth, self.admin_auth):
            response = self.client.get(reverse("knowledge-article-list-create"), **auth)
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(response.data["code"], "policy_acceptance_required")
        self.assertEqual(self.client.get(reverse("auth-me"), **self.member_auth).status_code, status.HTTP_200_OK)
        current = self.client.get(reverse("policies-current"), **self.member_auth).data
        self.assertEqual(len(current), 1)
        self.assertFalse(current[0]["accepted"])

        self.assertEqual(self._accept_all(self.member_auth).status_code, status.HTTP_204_NO_CONTENT)
        response = self.client.get(reverse("knowledge-article-list-create"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Admin accepts, edits, republishes -> v2, and the member is gated again.
        self._accept_all(self.admin_auth)
        response = self._publish(content="We keep your data private. Updated.")
        self.assertEqual(response.data["version"], 2)
        response = self.client.get(reverse("knowledge-article-list-create"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            PolicyVersion.objects.filter(organization=self.organization, kind="PRIVACY", is_current=True).count(), 1
        )
        # The v1 acceptance is kept as the record of what was agreed to.
        self.assertTrue(PolicyAcceptance.objects.filter(user=self.member, version__version=1).exists())

    def test_must_accept_every_pending_policy_at_once(self):
        self._publish()
        self._publish(kind="confidentiality", title="Confidentiality", content="Keep team data internal.")
        current = self.client.get(reverse("policies-current"), **self.member_auth).data
        response = self.client.post(
            reverse("policies-accept"), {"version_ids": [current[0]["id"]]}, format="json", **self.member_auth
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._accept_all(self.member_auth).status_code, status.HTTP_204_NO_CONTENT)

    def test_publishing_requires_content_and_changes(self):
        response = self.client.post(reverse("policies-publish", args=["privacy"]), **self.admin_auth)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self._publish()
        self._accept_all(self.admin_auth)
        response = self.client.post(reverse("policies-publish", args=["privacy"]), **self.admin_auth)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_managing_requires_organization_manage(self):
        response = self.client.get(reverse("policies-manage"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.put(
            reverse("policies-draft", args=["privacy"]), {"title": "x", "content": "y"}, format="json", **self.member_auth
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.get(reverse("policies-manage"), **self.admin_auth)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual({row["kind"] for row in response.data}, {"PRIVACY", "CONFIDENTIALITY"})

    def test_policies_are_per_organization(self):
        self._publish()
        other_org = create_test_organization(name="Other policy org")
        outsider = User.objects.create_user(email="policy-out@example.com", password="password123", organization=other_org)
        Role.objects.get(organization=other_org, name="Member").user_roles.create(user=outsider)
        login = self.client.post(
            reverse("auth-login"), {"email": outsider.email, "password": "password123"}, format="json"
        )
        auth = {"HTTP_AUTHORIZATION": f"Bearer {login.data['access']}"}
        self.assertEqual(self.client.get(reverse("knowledge-article-list-create"), **auth).status_code, 200)
        self.assertEqual(self.client.get(reverse("policies-current"), **auth).data, [])

    def test_public_endpoints_stay_reachable_while_gated(self):
        self._publish()
        # A gated user's browser still sends their token to public endpoints
        # like the org branding - those must not be refused.
        response = self.client.get(reverse("organization-settings"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("knowledge-article-list-create"), **self.member_auth)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
