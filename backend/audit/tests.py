from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User
from rbac.models import Role


class AuditTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login_with_role(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name=role_name).user_roles.create(user=user)
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
        _, head_access = self._login_with_role("activityhead@example.com", "Subteam Head")
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

    def test_entries_carry_a_display_name_and_linkable_target_not_raw_ids(self):
        head, head_access = self._login_with_role("feedhead@example.com", "Subteam Head")
        head.first_name, head.last_name = "Jordan", "Lee"
        head.save()
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Which prop for the MN5212?", "body": "..."},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "18x10"},
            format="json",
            **self._auth(head_access),
        )

        response = self.client.get(reverse("audit-knowledge-activity"), **self._auth(head_access))
        answered = next(e for e in response.data["results"] if e["action"] == "question.answer")
        self.assertEqual(answered["actor"]["first_name"], "Jordan")
        # An answer resolves to its question - the page you'd actually open -
        # instead of the old "Answer to <uuid>" target_repr.
        self.assertEqual(
            answered["target"], {"type": "question", "id": question["id"], "title": "Which prop for the MN5212?"}
        )
        self.assertNotIn("target_repr", answered)
        self.assertNotIn("ip_address", answered)

    def test_restricted_items_stay_out_of_the_feed_for_people_who_cannot_see_them(self):
        _, author_access = self._login_with_role("feedauthor@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Private budget question", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data

        _, other_access = self._login_with_role("feedother@example.com", "Member")
        response = self.client.get(reverse("audit-knowledge-activity"), **self._auth(other_access))
        titles = {(e["target"] or {}).get("title") for e in response.data["results"]}
        self.assertNotIn("Private budget question", titles)

        response = self.client.get(reverse("audit-knowledge-activity"), **self._auth(author_access))
        self.assertIn(question["id"], {(e["target"] or {}).get("id") for e in response.data["results"]})
