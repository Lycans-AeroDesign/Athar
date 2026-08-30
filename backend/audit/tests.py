from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from rbac.models import Role


class AuditTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_rbac")

    def _login_with_role(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123")
        Role.objects.get(name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}


class KnowledgeActivityViewTests(AuditTestCase):
    def test_requires_authentication_only_not_audit_read(self):
        # No audit.read permission needed - see KnowledgeActivityView's own
        # comment on why this is a separate, narrower, public-to-the-org feed.
        _, member_access = self._login_with_role("activitymember@example.com", "Member")
        response = self.client.get(reverse("audit-knowledge-activity"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_only_shows_knowledge_actions_not_sensitive_ones(self):
        _, head_access = self._login_with_role("activityhead@example.com", "Team/Subteam Head")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Activity Article", "content": "Body"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        # Creating a role emits a sensitive "role.create"-style audit action
        # that must NOT leak into the public feed - only an Organization
        # Admin holds role.manage.
        _, admin_access = self._login_with_role("activityadmin@example.com", "Organization Admin")
        self.client.post(
            reverse("rbac-roles"),
            {"name": "Activity Test Role", "description": "..."},
            format="json",
            **self._auth(admin_access),
        )

        response = self.client.get(reverse("audit-knowledge-activity"), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        actions = {entry["action"] for entry in response.data["results"]}
        self.assertIn("article.publish", actions)
        self.assertNotIn("role.create", actions)
