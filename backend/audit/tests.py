from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import RoleLoginMixin, create_test_organization


class AuditTestCase(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

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


class EmailVisibilityTests(AuditTestCase):
    def _member_emails(self, access):
        response = self.client.get(reverse("knowledge-org-members"), **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return {row["id"]: row["email"] for row in response.data["results"]}

    def test_emails_are_visible_by_default_and_hidden_once_turned_off(self):
        hidden, hidden_access = self._login_with_role("hidden@example.com", "Member")
        shown, _ = self._login_with_role("shown@example.com", "Member")
        guest, guest_access = self._login_with_role("guest-viewer@example.com", "Guest")
        _, admin_access = self._login_with_role("email-admin@example.com", "Organization Admin")
        self.assertTrue(shown.email_visible)

        response = self.client.patch(
            reverse("auth-me"), {"email_visible": False}, format="json", **self._auth(hidden_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(response.data["email_visible"])

        guest_view = self._member_emails(guest_access)
        self.assertIsNone(guest_view[str(hidden.id)])
        self.assertEqual(guest_view[str(shown.id)], "shown@example.com")
        self.assertEqual(guest_view[str(guest.id)], "guest-viewer@example.com")

        admin_view = self._member_emails(admin_access)
        self.assertEqual(admin_view[str(hidden.id)], "hidden@example.com")

        profile = self.client.get(reverse("knowledge-user-profile", args=[hidden.id]), **self._auth(guest_access))
        self.assertIsNone(profile.data["email"])


class AuditPrivacyTests(AuditTestCase):
    def test_invitation_codes_are_masked_in_the_audit_log(self):
        from accounts import services as account_services
        from audit.models import AuditLog

        admin, _ = self._login_with_role("invite-admin@example.com", "Organization Admin")
        invitation = account_services.create_invitation_code(created_by=admin, max_uses=5)
        response = self.client.post(
            reverse("auth-register"),
            {
                "email": "invited@example.com",
                "password": "a-strong-password-1",
                "invitation_code": invitation.code,
                "username": "invited",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(AuditLog.objects.filter(action="user.register").exists())

        for log in AuditLog.objects.filter(organization=self.organization):
            self.assertNotIn(invitation.code, log.target_repr)
            self.assertNotIn(invitation.code, str(log.metadata))
        self.assertTrue(AuditLog.objects.filter(action="invitation.create", target_repr=invitation.masked_code).exists())

    def test_old_ip_and_user_agent_are_scrubbed(self):
        from datetime import timedelta

        from django.utils import timezone

        from audit.models import AuditLog
        from audit.tasks import scrub_old_request_metadata

        old = AuditLog.objects.create(action="x.old", ip_address="10.0.0.1", user_agent="Old Browser")
        recent = AuditLog.objects.create(action="x.recent", ip_address="10.0.0.2", user_agent="New Browser")
        AuditLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=365))

        self.assertEqual(scrub_old_request_metadata(), 1)
        old.refresh_from_db()
        recent.refresh_from_db()
        self.assertIsNone(old.ip_address)
        self.assertEqual(old.user_agent, "")
        self.assertEqual(recent.ip_address, "10.0.0.2")
