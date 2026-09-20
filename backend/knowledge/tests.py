from django.core.files.uploadedfile import SimpleUploadedFile

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User
from audit.models import AuditLog
from files.models import StoredFile
from rbac.models import Role

from . import services
from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Bookmark,
    Category,
    Component,
    Document,
    Failure,
    KnowledgeRelation,
    Project,
    Question,
    QuestionAttachment,
    RestrictedAccessGrant,
    Sop,
    Tag,
    Test,
)


class KnowledgeTestCase(APITestCase):
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


class ArticleTests(KnowledgeTestCase):
    def test_create_requires_article_create_permission(self):
        _, guest_access = self._login_with_role("guest@example.com", "Guest")
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Test", "content": "Body"},
            format="json",
            **self._auth(guest_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Test", "content": "Body"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], Article.Status.DRAFT)

    def test_list_defaults_to_published_only(self):
        author, author_access = self._login_with_role("author@example.com", "Member")
        self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Draft Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        )

        _, other_access = self._login_with_role("other@example.com", "Member")
        response = self.client.get(reverse("knowledge-article-list-create"), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 0)

    def test_detail_hides_draft_from_non_author_non_reviewer(self):
        author, author_access = self._login_with_role("author2@example.com", "Member")
        created = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Secret Draft", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data

        _, other_access = self._login_with_role("other2@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-article-detail", args=[created["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Author can still see their own draft.
        response = self.client.get(
            reverse("knowledge-article-detail", args=[created["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_submit_only_by_author_then_publish_requires_article_publish(self):
        author, author_access = self._login_with_role("author3@example.com", "Member")
        created = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Workflow Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        article_id = created["id"]

        _, other_access = self._login_with_role("other3@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-article-submit", args=[article_id]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-article-submit", args=[article_id]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.IN_REVIEW)

        # Submitting again is invalid - 400, not a 500.
        response = self.client.post(
            reverse("knowledge-article-submit", args=[article_id]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        _, senior_access = self._login_with_role("senior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-article-publish", args=[article_id]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        response = self.client.post(
            reverse("knowledge-article-publish", args=[article_id]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.PUBLISHED)
        self.assertIsNotNone(response.data["published_at"])

    def test_update_creates_a_revision_only_on_content_or_title_change(self):
        author, author_access = self._login_with_role("author4@example.com", "Member")
        created = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Revision Article", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data
        article_id = created["id"]
        self.assertEqual(ArticleRevision.objects.filter(article_id=article_id).count(), 1)

        # Metadata-only change (excerpt) - no new revision.
        self.client.patch(
            reverse("knowledge-article-detail", args=[article_id]),
            {"excerpt": "A short excerpt"},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(ArticleRevision.objects.filter(article_id=article_id).count(), 1)

        # Content change - a new revision.
        self.client.patch(
            reverse("knowledge-article-detail", args=[article_id]),
            {"content": "V2"},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(ArticleRevision.objects.filter(article_id=article_id).count(), 2)
        latest = ArticleRevision.objects.filter(article_id=article_id).order_by("-created_at").first()
        self.assertEqual(latest.content, "V2")

    def test_tag_names_are_normalized_and_deduplicated(self):
        _, author_access = self._login_with_role("author5@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Tagged Article", "content": "Body", "tag_names": ["Servo", "servo", " Servo "]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual([t["name"] for t in response.data["tags"]], ["servo"])

    def test_mutations_create_audit_log_rows(self):
        author, author_access = self._login_with_role("author6@example.com", "Member")
        created = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Audited Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        self.assertTrue(AuditLog.objects.filter(action="article.create", actor=author).exists())

        self.client.post(reverse("knowledge-article-submit", args=[created["id"]]), **self._auth(author_access))
        self.assertTrue(AuditLog.objects.filter(action="article.submit", actor=author).exists())


class QuestionAndAnswerTests(KnowledgeTestCase):
    def test_ask_requires_question_create_and_answer_requires_question_answer(self):
        _, guest_access = self._login_with_role("guest2@example.com", "Guest")
        response = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Why?", "body": "Because."},
            format="json",
            **self._auth(guest_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        asker, asker_access = self._login_with_role("asker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Why does it beep?", "body": "It beeps a lot."},
            format="json",
            **self._auth(asker_access),
        ).data

        response = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Try this."},
            format="json",
            **self._auth(guest_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, answerer_access = self._login_with_role("answerer@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Try this."},
            format="json",
            **self._auth(answerer_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data["is_accepted"])

    def test_accept_only_by_question_author_or_moderator_and_replaces_previous(self):
        asker, asker_access = self._login_with_role("asker2@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Which fix?", "body": "..."},
            format="json",
            **self._auth(asker_access),
        ).data

        _, answerer_access = self._login_with_role("answerer2@example.com", "Member")
        answer_a = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Option A"},
            format="json",
            **self._auth(answerer_access),
        ).data
        answer_b = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Option B"},
            format="json",
            **self._auth(answerer_access),
        ).data

        _, unrelated_access = self._login_with_role("unrelated@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer_a["id"]},
            format="json",
            **self._auth(unrelated_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer_a["id"]},
            format="json",
            **self._auth(asker_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        by_id = {a["id"]: a for a in response.data["answers"]}
        self.assertTrue(by_id[answer_a["id"]]["is_accepted"])
        self.assertFalse(by_id[answer_b["id"]]["is_accepted"])

        # Accepting a different answer replaces the first - at most one accepted answer.
        response = self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer_b["id"]},
            format="json",
            **self._auth(asker_access),
        )
        by_id = {a["id"]: a for a in response.data["answers"]}
        self.assertFalse(by_id[answer_a["id"]]["is_accepted"])
        self.assertTrue(by_id[answer_b["id"]]["is_accepted"])

        # A Mentor (question.moderate) can also accept, on someone else's question.
        _, moderator_access = self._login_with_role("moderator@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer_a["id"]},
            format="json",
            **self._auth(moderator_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_deleting_accepted_answer_clears_questions_accepted_answer(self):
        asker, asker_access = self._login_with_role("asker3@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Q", "body": "..."},
            format="json",
            **self._auth(asker_access),
        ).data
        answer = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "A"},
            format="json",
            **self._auth(asker_access),
        ).data
        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(asker_access),
        )
        self.assertEqual(str(Question.objects.get(pk=question["id"]).accepted_answer_id), answer["id"])

        self.client.delete(reverse("knowledge-answer-detail", args=[answer["id"]]), **self._auth(asker_access))
        self.assertIsNone(Question.objects.get(pk=question["id"]).accepted_answer_id)
        self.assertFalse(Answer.objects.filter(pk=answer["id"]).exists())


class CategoryAndTagTests(KnowledgeTestCase):
    def test_require_authentication_only(self):
        response = self.client.get(reverse("knowledge-category-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # Categories are now org-scoped (multi-tenancy retrofit) - this
        # test's own fresh organization starts with none of its own, unlike
        # the fixed set knowledge/migrations/0002_manual_seed_categories.py
        # seeds for the migration-time bootstrap organization only.
        Category.objects.create(organization=self.organization, name="Avionics", slug="avionics")

        _, guest_access = self._login_with_role("guest3@example.com", "Guest")
        response = self.client.get(reverse("knowledge-category-list"), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(response.data["count"], 0)

        response = self.client.get(reverse("knowledge-tag-list"), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_create_and_delete_require_category_manage_permission(self):
        _, member_access = self._login_with_role("categmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-category-list"),
            {"name": "Ground Support"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("categadmin@example.com", "Organization Admin")
        response = self.client.post(
            reverse("knowledge-category-list"),
            {"name": "Ground Support"},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["slug"], "ground-support")
        category_id = response.data["id"]

        response = self.client.delete(
            reverse("knowledge-category-detail", args=[category_id]), **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(
            reverse("knowledge-category-detail", args=[category_id]), **self._auth(admin_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Category.objects.filter(pk=category_id).exists())

    def test_deleting_a_category_uncategorizes_its_articles_instead_of_deleting_them(self):
        _, admin_access = self._login_with_role("categadmin2@example.com", "Organization Admin")
        category = self.client.post(
            reverse("knowledge-category-list"),
            {"name": "Payloads"},
            format="json",
            **self._auth(admin_access),
        ).data
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Motor Sizing", "content": "Body", "category_id": category["id"]},
            format="json",
            **self._auth(admin_access),
        ).data

        self.client.delete(reverse("knowledge-category-detail", args=[category["id"]]), **self._auth(admin_access))

        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(admin_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["category"])

    def test_rename_requires_category_manage_permission(self):
        _, admin_access = self._login_with_role("categadmin3@example.com", "Organization Admin")
        category = self.client.post(
            reverse("knowledge-category-list"),
            {"name": "Firmware"},
            format="json",
            **self._auth(admin_access),
        ).data

        _, member_access = self._login_with_role("categmember2@example.com", "Member")
        response = self.client.patch(
            reverse("knowledge-category-detail", args=[category["id"]]),
            {"description": "Nope"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.patch(
            reverse("knowledge-category-detail", args=[category["id"]]),
            {"description": "Ground/autopilot code."},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["description"], "Ground/autopilot code.")
        # Slug is stable across a rename - same precedent as Article's slug.
        self.assertEqual(response.data["slug"], "firmware")

    def test_tag_create_is_idempotent_and_delete_requires_tag_manage(self):
        _, member_access = self._login_with_role("tagmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-tag-list"), {"name": " Servo "}, format="json", **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "servo")
        tag_id = response.data["id"]

        # Posting the same (differently-cased/spaced) name again reuses the row.
        response = self.client.post(
            reverse("knowledge-tag-list"), {"name": "SERVO"}, format="json", **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["id"], tag_id)
        self.assertEqual(Tag.objects.filter(name="servo").count(), 1)

        response = self.client.delete(reverse("knowledge-tag-detail", args=[tag_id]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("tagadmin@example.com", "Organization Admin")
        response = self.client.delete(reverse("knowledge-tag-detail", args=[tag_id]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Tag.objects.filter(pk=tag_id).exists())


class ArticleWorkflowExtraTests(KnowledgeTestCase):
    def test_reject_sends_in_review_back_to_rejected_and_author_can_resubmit(self):
        author, author_access = self._login_with_role("rejauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Needs Work", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))

        _, senior_access = self._login_with_role("rejsenior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-article-reject", args=[article["id"]]),
            {"reason": "Needs more detail"},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.REJECTED)

        # Rejecting again (already REJECTED, not IN_REVIEW) is invalid.
        response = self.client.post(
            reverse("knowledge-article-reject", args=[article["id"]]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Author can edit a rejected draft and resubmit it.
        response = self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"content": "V2"},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.post(
            reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.IN_REVIEW)

    def test_archive_requires_article_archive_and_only_from_published(self):
        author, author_access = self._login_with_role("archauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Old Guide", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data

        _, head_access = self._login_with_role("archhead@example.com", "Subteam Head")
        response = self.client.post(
            reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        _, senior_access = self._login_with_role("archsenior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.ARCHIVED)

    def test_unarchive_requires_article_archive_and_only_from_archived(self):
        author, author_access = self._login_with_role("unarchauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Old Guide", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data

        _, head_access = self._login_with_role("unarchhead@example.com", "Subteam Head")
        # Still a draft - nothing to unarchive yet.
        response = self.client.post(
            reverse("knowledge-article-unarchive", args=[article["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        published_at = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(head_access)
        ).data["published_at"]
        self.client.post(reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access))

        _, senior_access = self._login_with_role("unarchsenior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-article-unarchive", args=[article["id"]]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-article-unarchive", args=[article["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.PUBLISHED)
        # Restoring isn't republishing - the original publish date is preserved.
        self.assertEqual(response.data["published_at"], published_at)

    def test_archived_article_cannot_be_edited_even_with_article_update(self):
        author, author_access = self._login_with_role("frozenauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Old Guide", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data

        _, head_access = self._login_with_role("frozenhead@example.com", "Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access))

        # Subteam Head holds article.update (a blanket override) - even
        # so, archived is frozen until explicitly unarchived.
        response = self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"title": "Sneaky edit"},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"title": "Sneaky edit"},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_status_all_shows_published_plus_own_for_non_reviewer_and_everything_for_reviewer(self):
        author, author_access = self._login_with_role("allauthor@example.com", "Member")
        draft = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "My Draft", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data

        _, head_access = self._login_with_role("allhead@example.com", "Subteam Head")
        other_published = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Someone Else's Published", "content": "V1"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(
            reverse("knowledge-article-submit", args=[other_published["id"]]), **self._auth(head_access)
        )
        self.client.post(
            reverse("knowledge-article-publish", args=[other_published["id"]]), **self._auth(head_access)
        )

        _, other_access = self._login_with_role("allother@example.com", "Member")
        other_draft = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Someone Else's Draft", "content": "V1"},
            format="json",
            **self._auth(other_access),
        ).data

        # Plain member: their own draft + the published one, not the other member's draft.
        response = self.client.get(
            reverse("knowledge-article-list-create"), {"status": "ALL"}, **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {a["id"] for a in response.data["results"]}
        self.assertEqual(ids, {draft["id"], other_published["id"]})

        # Reviewer/publisher: everything, regardless of author or status.
        response = self.client.get(
            reverse("knowledge-article-list-create"), {"status": "ALL"}, **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {a["id"] for a in response.data["results"]}
        self.assertEqual(ids, {draft["id"], other_published["id"], other_draft["id"]})

    def test_revisions_endpoint_matches_article_visibility(self):
        author, author_access = self._login_with_role("revauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Revisioned", "content": "V1"},
            format="json",
            **self._auth(author_access),
        ).data
        self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"content": "V2"},
            format="json",
            **self._auth(author_access),
        )

        _, other_access = self._login_with_role("revother@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-article-revisions", args=[article["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(
            reverse("knowledge-article-revisions", args=[article["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["content"], "V2")


class QuestionStatusAndPromotionTests(KnowledgeTestCase):
    def test_status_follows_answer_and_accept_lifecycle(self):
        asker, asker_access = self._login_with_role("statusasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Q", "body": "..."},
            format="json",
            **self._auth(asker_access),
        ).data
        self.assertEqual(question["status"], Question.Status.OPEN)

        _, answerer_access = self._login_with_role("statusanswerer@example.com", "Member")
        answer = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "A"},
            format="json",
            **self._auth(answerer_access),
        ).data
        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.data["status"], Question.Status.ANSWERED)

        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(asker_access),
        )
        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.data["status"], Question.Status.SOLVED)

        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": None},
            format="json",
            **self._auth(asker_access),
        )
        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.data["status"], Question.Status.ANSWERED)

    def test_close_blocks_new_answers_and_reopen_recomputes_status(self):
        asker, asker_access = self._login_with_role("closeasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Closing Q", "body": "..."},
            format="json",
            **self._auth(asker_access),
        ).data

        _, other_access = self._login_with_role("closeother@example.com", "Member")
        response = self.client.post(reverse("knowledge-question-close", args=[question["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(reverse("knowledge-question-close", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Question.Status.CLOSED)

        response = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Too late"},
            format="json",
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(reverse("knowledge-question-reopen", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Question.Status.OPEN)

    def test_promote_requires_accepted_answer_and_article_create_and_is_one_shot(self):
        asker, asker_access = self._login_with_role("promoteasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Why does it beep", "body": "Details"},
            format="json",
            **self._auth(asker_access),
        ).data

        response = self.client.post(reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        answer = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Check the power supply"},
            format="json",
            **self._auth(asker_access),
        ).data
        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(asker_access),
        )

        _, guest_access = self._login_with_role("promoteguest@example.com", "Guest")
        response = self.client.post(reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("Check the power supply", response.data["content"])
        article_id = response.data["id"]

        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.data["promoted_to_article"], article_id)

        # Already promoted - a second attempt is rejected rather than creating a duplicate article.
        response = self.client.post(reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class SearchTests(KnowledgeTestCase):
    def test_search_scopes_by_type_and_only_returns_published_articles(self):
        author, author_access = self._login_with_role("searchauthor@example.com", "Member")
        draft = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Pixhawk Draft Notes", "content": "unpublished"},
            format="json",
            **self._auth(author_access),
        ).data

        _, head_access = self._login_with_role("searchhead@example.com", "Subteam Head")
        published = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Pixhawk 6X Configuration", "content": "wiring guide"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-submit", args=[published["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-publish", args=[published["id"]]), **self._auth(head_access))

        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Pixhawk keeps rebooting", "body": "..."},
            format="json",
            **self._auth(author_access),
        )

        response = self.client.get(reverse("knowledge-search") + "?q=pixhawk", **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        result_ids = {r["id"] for r in response.data["results"]}
        self.assertIn(published["id"], result_ids)
        self.assertNotIn(draft["id"], result_ids)
        # The unpublished draft doesn't count either - counts reflect what
        # search can actually surface, not raw title matches. Only
        # article/question have any matches here - the engineering-domain
        # types (see EngineeringDomainTests) are just 0.
        expected_counts = {
            "article": 1,
            "question": 1,
            "project": 0,
            "component": 0,
            "failure": 0,
            "sop": 0,
            "test": 0,
            "document": 0,
        }
        self.assertEqual(response.data["counts"], expected_counts)

        response = self.client.get(reverse("knowledge-search") + "?q=pixhawk&type=article", **self._auth(author_access))
        self.assertTrue(all(r["type"] == "article" for r in response.data["results"]))
        # Counts stay unscoped even when ?type= narrows the results themselves,
        # so a filter list can show every option's total from one request.
        self.assertEqual(response.data["counts"], expected_counts)

        response = self.client.get(reverse("knowledge-search") + "?q=pixhawk&type=question", **self._auth(author_access))
        self.assertTrue(all(r["type"] == "question" for r in response.data["results"]))
        self.assertTrue(any("rebooting" in r["title"] for r in response.data["results"]))

    def test_search_sort_orders_by_updated_at(self):
        _, head_access = self._login_with_role("searchsort@example.com", "Subteam Head")
        older = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Sortex Older", "content": "body"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-submit", args=[older["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-publish", args=[older["id"]]), **self._auth(head_access))

        newer = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Sortex Newer", "content": "body"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-submit", args=[newer["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-publish", args=[newer["id"]]), **self._auth(head_access))

        response = self.client.get(reverse("knowledge-search") + "?q=sortex&sort=newest", **self._auth(head_access))
        self.assertEqual([r["id"] for r in response.data["results"]], [newer["id"], older["id"]])

        response = self.client.get(reverse("knowledge-search") + "?q=sortex&sort=oldest", **self._auth(head_access))
        self.assertEqual([r["id"] for r in response.data["results"]], [older["id"], newer["id"]])

        # Default (no ?sort=) is now "relevance" (see knowledge/search.py) -
        # both are equally good title matches for "sortex" so the exact tie-
        # break order isn't asserted here, just that ranking is what's
        # actually engaged (not an error, both still found).
        response = self.client.get(reverse("knowledge-search") + "?q=sortex", **self._auth(head_access))
        self.assertEqual({r["id"] for r in response.data["results"]}, {newer["id"], older["id"]})

        response = self.client.get(reverse("knowledge-search") + "?q=sortex&sort=relevance", **self._auth(head_access))
        self.assertEqual({r["id"] for r in response.data["results"]}, {newer["id"], older["id"]})

        response = self.client.get(reverse("knowledge-search") + "?q=sortex&sort=bogus", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_search_excludes_restricted_question_from_non_moderators(self):
        author, author_access = self._login_with_role("searchrestrictedq@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Confidential Sponsor Deal", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data

        _, other_access = self._login_with_role("searchrestrictedqother@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-search") + "?q=confidential", **self._auth(other_access)
        )
        self.assertNotIn(question["id"], {r["id"] for r in response.data["results"]})
        self.assertEqual(response.data["counts"]["question"], 0)

        # The author and a question.moderate holder still find it.
        response = self.client.get(reverse("knowledge-search") + "?q=confidential", **self._auth(author_access))
        self.assertIn(question["id"], {r["id"] for r in response.data["results"]})

        _, moderator_access = self._login_with_role("searchrestrictedqmod@example.com", "Mentor")
        response = self.client.get(reverse("knowledge-search") + "?q=confidential", **self._auth(moderator_access))
        self.assertIn(question["id"], {r["id"] for r in response.data["results"]})

    def test_search_excludes_restricted_published_article_from_non_privileged(self):
        author, author_access = self._login_with_role("searchrestricteda@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Sponsor Budget Breakdown", "content": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data
        _, head_access = self._login_with_role("searchrestrictedahead@example.com", "Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        _, other_access = self._login_with_role("searchrestrictedaother@example.com", "Member")
        response = self.client.get(reverse("knowledge-search") + "?q=sponsor+budget", **self._auth(other_access))
        self.assertNotIn(article["id"], {r["id"] for r in response.data["results"]})
        self.assertEqual(response.data["counts"]["article"], 0)

        # The author and a reviewer/publisher still find it.
        response = self.client.get(reverse("knowledge-search") + "?q=sponsor+budget", **self._auth(author_access))
        self.assertIn(article["id"], {r["id"] for r in response.data["results"]})
        response = self.client.get(reverse("knowledge-search") + "?q=sponsor+budget", **self._auth(head_access))
        self.assertIn(article["id"], {r["id"] for r in response.data["results"]})

    def test_tag_filter_returns_items_across_taggable_types(self):
        """?tag=<id> (no ?q=) browses everything with that tag, across every
        taggable type at once - including Failure in the response, whose
        queryset has no `tags` field at all (see SearchView._TAGGABLE_TYPES);
        if that guard were missing this would 500, not just under-count."""
        _, head_access = self._login_with_role("searchtaghead@example.com", "Subteam Head")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Battery Notes", "content": "...", "tag_names": ["propulsion"]},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Falcon Propulsion", "tag_names": ["propulsion"]},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "Unrelated failure", "component_id": None, "project_id": None},
            format="json",
            **self._auth(head_access),
        )
        tags = self.client.get(reverse("knowledge-tag-list"), **self._auth(head_access)).data["results"]
        tag_id = next(t["id"] for t in tags if t["name"] == "propulsion")

        response = self.client.get(reverse("knowledge-search") + f"?tag={tag_id}", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["tag"]["name"], "propulsion")
        result_ids = {r["id"] for r in response.data["results"]}
        self.assertIn(article["id"], result_ids)
        self.assertIn(project["id"], result_ids)
        self.assertEqual(response.data["counts"]["failure"], 0)

    def test_tag_filter_scoped_by_type_but_counts_stay_unscoped(self):
        _, head_access = self._login_with_role("searchtagscopehead@example.com", "Subteam Head")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Wiring Guide", "content": "...", "tag_names": ["avionics"]},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        tags = self.client.get(reverse("knowledge-tag-list"), **self._auth(head_access)).data["results"]
        tag_id = next(t["id"] for t in tags if t["name"] == "avionics")

        response = self.client.get(
            reverse("knowledge-search") + f"?tag={tag_id}&type=project", **self._auth(head_access)
        )
        self.assertEqual(response.data["results"], [])
        self.assertEqual(response.data["counts"]["article"], 1)

    def test_tag_filter_rejects_unknown_or_malformed_tag_id(self):
        _, head_access = self._login_with_role("searchtagbadhead@example.com", "Subteam Head")
        response = self.client.get(
            reverse("knowledge-search") + "?tag=00000000-0000-0000-0000-000000000000", **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.get(reverse("knowledge-search") + "?tag=not-a-uuid", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_tag_filter_respects_restricted_visibility(self):
        author, author_access = self._login_with_role("searchtagresta@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Internal Notes", "content": "...", "visibility": "RESTRICTED", "tag_names": ["internal"]},
            format="json",
            **self._auth(author_access),
        ).data
        _, head_access = self._login_with_role("searchtagresthead@example.com", "Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        tags = self.client.get(reverse("knowledge-tag-list"), **self._auth(head_access)).data["results"]
        tag_id = next(t["id"] for t in tags if t["name"] == "internal")

        _, other_access = self._login_with_role("searchtagrestother@example.com", "Member")
        response = self.client.get(reverse("knowledge-search") + f"?tag={tag_id}", **self._auth(other_access))
        self.assertNotIn(article["id"], {r["id"] for r in response.data["results"]})

        response = self.client.get(reverse("knowledge-search") + f"?tag={tag_id}", **self._auth(author_access))
        self.assertIn(article["id"], {r["id"] for r in response.data["results"]})

    def test_tag_filter_cross_org_id_not_found(self):
        other_org = create_test_organization(name="Search Tag Other Org")
        other_head = User.objects.create_user(
            email="searchtagotherorghead@example.com", password="password123", organization=other_org
        )
        Role.objects.get(organization=other_org, name="Subteam Head").user_roles.create(user=other_head)
        other_head_access = self.client.post(
            reverse("auth-login"), {"email": other_head.email, "password": "password123"}, format="json"
        ).data["access"]
        other_article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Other Org Article", "content": "...", "tag_names": ["shared-name"]},
            format="json",
            **self._auth(other_head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[other_article["id"]]), **self._auth(other_head_access))
        other_tags = self.client.get(reverse("knowledge-tag-list"), **self._auth(other_head_access)).data["results"]
        other_tag_id = next(t["id"] for t in other_tags if t["name"] == "shared-name")

        _, head_access = self._login_with_role("searchtagcrossorghead@example.com", "Subteam Head")
        response = self.client.get(reverse("knowledge-search") + f"?tag={other_tag_id}", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class VisibilityTests(KnowledgeTestCase):
    def test_restricted_article_hidden_from_non_privileged_even_when_published(self):
        author, author_access = self._login_with_role("visauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Sensitive Doc", "content": "Body", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data
        self.assertEqual(article["visibility"], "RESTRICTED")

        _, head_access = self._login_with_role("vishead@example.com", "Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        _, other_access = self._login_with_role("visother@example.com", "Member")
        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Not in the published list either.
        response = self.client.get(reverse("knowledge-article-list-create"), **self._auth(other_access))
        self.assertNotIn(article["id"], {a["id"] for a in response.data["results"]})

        # But the author and a reviewer/publisher can still see it.
        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_public_visibility_is_default_and_unaffected(self):
        _, author_access = self._login_with_role("visauthor2@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Normal Doc", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        self.assertEqual(article["visibility"], "PUBLIC")

    def test_restricted_question_hidden_from_non_moderators(self):
        author, author_access = self._login_with_role("visqauthor@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Private Q", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data

        _, other_access = self._login_with_role("visqother@example.com", "Member")
        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class KnowledgeRelationTests(KnowledgeTestCase):
    def test_create_list_and_delete_relation_between_two_articles(self):
        author, author_access = self._login_with_role("relauthor@example.com", "Member")
        article_a = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Article A", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        article_b = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Article B", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "article", "source_id": article_a["id"], "target_type": "article", "target_id": article_b["id"]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["other_type"], "article")
        self.assertEqual(response.data["other_id"], article_b["id"])
        relation_id = response.data["id"]

        # Visible from both sides, each showing "the other one".
        response = self.client.get(reverse("knowledge-article-relations", args=[article_a["id"]]), **self._auth(author_access))
        self.assertEqual(response.data[0]["other_id"], article_b["id"])
        response = self.client.get(reverse("knowledge-article-relations", args=[article_b["id"]]), **self._auth(author_access))
        self.assertEqual(response.data[0]["other_id"], article_a["id"])

        # Duplicate creation is idempotent (get_or_create), not an error or a second row.
        self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "article", "source_id": article_a["id"], "target_type": "article", "target_id": article_b["id"]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(KnowledgeRelation.objects.count(), 1)

        _, other_access = self._login_with_role("relother@example.com", "Member")
        response = self.client.delete(reverse("knowledge-relation-detail", args=[relation_id]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(reverse("knowledge-relation-detail", args=[relation_id]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(KnowledgeRelation.objects.exists())

    def test_restricted_other_side_is_hidden_from_relations_list(self):
        """A relation's "other side" must respect ITS OWN visibility, not just
        the visibility of the item whose relations list you're viewing -
        KnowledgeRelationSerializer only ever renders "the other side" with no
        visibility check of its own, so get_relations_for is what has to filter."""
        author, author_access = self._login_with_role("relvisauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Public Doc", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        # Published, so a non-author, non-privileged viewer can see the article
        # itself (and thus reach its relations endpoint at all) - the point of
        # this test is that the *related question* stays hidden, not the article.
        _, head_access = self._login_with_role("relvishead@example.com", "Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Private Q", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "article", "source_id": article["id"], "target_type": "question", "target_id": question["id"]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # A viewer with no relationship to the restricted question can see the
        # (public) article's relations endpoint at all, but the restricted
        # question must not appear in the list - not its title, not its id.
        _, other_access = self._login_with_role("relvisother@example.com", "Member")
        response = self.client.get(reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

        # The question's own author still sees it.
        response = self.client.get(reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(author_access))
        self.assertEqual([r["other_id"] for r in response.data], [question["id"]])

        # So does a question.moderate holder who isn't the author.
        _, moderator_access = self._login_with_role("relvismod@example.com", "Mentor")
        response = self.client.get(reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(moderator_access))
        self.assertEqual([r["other_id"] for r in response.data], [question["id"]])

    def test_cannot_relate_to_self_or_unknown_type(self):
        _, author_access = self._login_with_role("relauthor2@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Solo Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "article", "source_id": article["id"], "target_type": "article", "target_id": article["id"]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_relation_requires_edit_rights_on_source(self):
        _, author_access = self._login_with_role("relauthor3@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Owned Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Someone's Question", "body": "..."},
            format="json",
            **self._auth(author_access),
        ).data

        _, other_access = self._login_with_role("relother2@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "question", "source_id": question["id"], "target_type": "article", "target_id": article["id"]},
            format="json",
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_semantic_relation_type_stores_canonical_direction_and_labels_both_sides(self):
        """Picking "USES" from the Project's own page stores Project--USES-->
        Component, and each side's relation_label reads correctly - the
        Project sees "USES", the Component sees "USED_IN" - even though only
        one row exists in the database."""
        _, head_access = self._login_with_role("semrelhead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "DBF 2027"}, format="json", **self._auth(head_access)
        ).data
        component = self.client.post(
            reverse("knowledge-component-list-create"), {"name": "Pixhawk 6X"}, format="json", **self._auth(head_access)
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "project",
                "source_id": project["id"],
                "target_type": "component",
                "target_id": component["id"],
                "relation_type": "USES",
            },
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["relation_type"], "USES")
        self.assertEqual(response.data["relation_label"], "USES")
        self.assertEqual(KnowledgeRelation.objects.count(), 1)

        project_relations = self.client.get(
            reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual(project_relations[0]["relation_label"], "USES")
        self.assertEqual(project_relations[0]["other_id"], component["id"])

        component_relations = self.client.get(
            reverse("knowledge-component-relations", args=[component["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual(component_relations[0]["relation_label"], "USED_IN")
        self.assertEqual(component_relations[0]["other_id"], project["id"])

    def test_semantic_relation_type_normalizes_when_picked_from_reverse_side(self):
        """Picking "USED_IN" from the Component's own page (source=component,
        target=project) still stores the canonical Project--USES-->Component
        direction, not a second, differently-shaped row - and the edit-rights
        check still applies to the Component (the caller's actual source),
        not the Project it gets normalized onto."""
        _, head_access = self._login_with_role("semrelhead2@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "DBF 2027"}, format="json", **self._auth(head_access)
        ).data
        component = self.client.post(
            reverse("knowledge-component-list-create"), {"name": "Pixhawk 6X"}, format="json", **self._auth(head_access)
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "component",
                "source_id": component["id"],
                "target_type": "project",
                "target_id": project["id"],
                "relation_type": "USED_IN",
            },
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # The response's own "other side" is relative to the caller's source
        # (component), so it should report USED_IN + the project as other,
        # even though storage normalized to the opposite direction.
        self.assertEqual(response.data["relation_label"], "USED_IN")
        self.assertEqual(response.data["other_id"], project["id"])

        relation = KnowledgeRelation.objects.get()
        self.assertEqual(relation.relation_type, "USES")
        self.assertEqual(str(relation.source_object_id), project["id"])
        self.assertEqual(str(relation.target_object_id), component["id"])

    def test_unknown_semantic_relation_type_for_the_type_pair_is_rejected(self):
        _, head_access = self._login_with_role("semrelhead3@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "DBF 2027"}, format="json", **self._auth(head_access)
        ).data
        sop = self.client.post(
            reverse("knowledge-sop-list-create"), {"title": "Preflight Checklist"}, format="json", **self._auth(head_access)
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                # INVOLVED_IN is only defined between component and failure -
                # not project and sop.
                "source_type": "project",
                "source_id": project["id"],
                "target_type": "sop",
                "target_id": sop["id"],
                "relation_type": "INVOLVED_IN",
            },
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(KnowledgeRelation.objects.exists())

    def test_generic_related_still_works_and_labels_symmetrically(self):
        """The pre-existing plain "RELATED" behavior is unchanged - every
        relation created before this registry existed is one of these."""
        author, author_access = self._login_with_role("semrelplain@example.com", "Member")
        article_a = self.client.post(
            reverse("knowledge-article-list-create"), {"title": "A", "content": "..."}, format="json", **self._auth(author_access)
        ).data
        article_b = self.client.post(
            reverse("knowledge-article-list-create"), {"title": "B", "content": "..."}, format="json", **self._auth(author_access)
        ).data
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "article", "source_id": article_a["id"], "target_type": "article", "target_id": article_b["id"]},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["relation_type"], "RELATED")
        self.assertEqual(response.data["relation_label"], "RELATED")


class ArticleAttachmentTests(KnowledgeTestCase):
    def _upload(self, access_token, filename="datasheet.txt"):
        upload = self.client.post(
            reverse("files-upload"),
            {"file": SimpleUploadedFile(filename, b"some file content")},
            format="multipart",
            **self._auth(access_token),
        )
        self.assertEqual(upload.status_code, status.HTTP_201_CREATED)
        return upload.data["id"]

    def test_add_list_and_remove_article_attachment(self):
        _, author_access = self._login_with_role("attachauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Attach Article", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data
        file_id = self._upload(author_access)

        response = self.client.post(
            reverse("knowledge-article-attachment-list", args=[article["id"]]),
            {"file_id": file_id},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["file"]["id"], file_id)
        attachment_id = response.data["id"]

        response = self.client.get(
            reverse("knowledge-article-attachment-list", args=[article["id"]]), **self._auth(author_access)
        )
        self.assertEqual(len(response.data), 1)

        _, other_access = self._login_with_role("attachother@example.com", "Member")
        response = self.client.delete(
            reverse("knowledge-article-attachment-detail", args=[article["id"], attachment_id]),
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(
            reverse("knowledge-article-attachment-detail", args=[article["id"], attachment_id]),
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ArticleAttachment.objects.exists())


class QuestionAttachmentTests(KnowledgeTestCase):
    def _upload(self, access_token, filename="log.txt"):
        upload = self.client.post(
            reverse("files-upload"),
            {"file": SimpleUploadedFile(filename, b"some log content")},
            format="multipart",
            **self._auth(access_token),
        )
        self.assertEqual(upload.status_code, status.HTTP_201_CREATED)
        return upload.data["id"]

    def test_add_list_and_remove_question_attachment(self):
        _, asker_access = self._login_with_role("qattachasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Attach Question", "body": "Body"},
            format="json",
            **self._auth(asker_access),
        ).data
        file_id = self._upload(asker_access)

        response = self.client.post(
            reverse("knowledge-question-attachment-list", args=[question["id"]]),
            {"file_id": file_id},
            format="json",
            **self._auth(asker_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        attachment_id = response.data["id"]

        _, other_access = self._login_with_role("qattachother@example.com", "Member")
        response = self.client.delete(
            reverse("knowledge-question-attachment-detail", args=[question["id"], attachment_id]),
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(
            reverse("knowledge-question-attachment-detail", args=[question["id"], attachment_id]),
            **self._auth(asker_access),
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(QuestionAttachment.objects.exists())


class EngineeringDomainTests(KnowledgeTestCase):
    """Project/Component/Failure/Sop: no draft/review workflow (see
    models.py) - so unlike Article/Question these tests only need to prove
    CRUD + the x.read/x.create/x.update/x.delete permission gate, not a
    status state machine."""

    def test_project_crud_and_permission_gating(self):
        _, member_access = self._login_with_role("projmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "DBF 2027"}, format="json", **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no project.create

        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)  # project.read is granted

        _, head_access = self._login_with_role("projhead@example.com", "Subteam Head")
        response = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "DBF 2027", "description": "Season aircraft", "tag_names": ["dbf"]},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project = response.data
        self.assertEqual(project["status"], "ACTIVE")
        self.assertEqual([t["name"] for t in project["tags"]], ["dbf"])

        response = self.client.patch(
            reverse("knowledge-project-detail", args=[project["id"]]),
            {"status": "ON_HOLD"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no project.update

        response = self.client.patch(
            reverse("knowledge-project-detail", args=[project["id"]]),
            {"status": "ON_HOLD"},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ON_HOLD")

        response = self.client.delete(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no project.delete

        response = self.client.delete(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.exists())

    def test_component_crud_and_permission_gating(self):
        _, member_access = self._login_with_role("compmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-component-list-create"),
            {
                "name": "Pixhawk 6X",
                "manufacturer": "Holybro",
                "part_number": "HB-PX6X-001",
                "specifications": [{"label": "Processor", "value": "STM32H753"}],
            },
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)  # Member has component.create
        component = response.data
        self.assertEqual(component["status"], "TESTING")
        self.assertEqual(component["specifications"], [{"label": "Processor", "value": "STM32H753"}])

        response = self.client.patch(
            reverse("knowledge-component-detail", args=[component["id"]]),
            {"status": "CERTIFIED"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no component.update

        _, senior_access = self._login_with_role("compsenior@example.com", "Mentor")
        response = self.client.patch(
            reverse("knowledge-component-detail", args=[component["id"]]),
            {"status": "CERTIFIED"},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.delete(
            reverse("knowledge-component-detail", args=[component["id"]]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no component.delete

        _, head_access = self._login_with_role("comphead@example.com", "Subteam Head")
        response = self.client.delete(
            reverse("knowledge-component-detail", args=[component["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Component.objects.exists())

    def test_component_rejects_malformed_specifications(self):
        _, member_access = self._login_with_role("compbad@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Bad Spec Component", "specifications": [{"label": "Only a label"}]},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_component_inventory_fields_and_photo_upload(self):
        member, member_access = self._login_with_role("compinventory@example.com", "Member")
        photo = StoredFile.objects.create(
            organization=member.organization,
            file=SimpleUploadedFile("part.png", b"fake-png-bytes", content_type="image/png"),
            original_filename="part.png",
            content_type="image/png",
            size=14,
        )
        response = self.client.post(
            reverse("knowledge-component-list-create"),
            {
                "name": "M3508 Motor",
                "quantity_available": 12,
                "link": "https://example.com/datasheet.pdf",
                "photo_id": str(photo.pk),
            },
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        component = response.data
        self.assertEqual(component["quantity_available"], 12)
        self.assertEqual(component["link"], "https://example.com/datasheet.pdf")
        self.assertEqual(component["photo"]["id"], str(photo.pk))

        # Also visible from the list endpoint, not just create's own response.
        response = self.client.get(reverse("knowledge-component-list-create"), **self._auth(member_access))
        self.assertEqual(response.data["results"][0]["quantity_available"], 12)
        self.assertEqual(response.data["results"][0]["photo"]["id"], str(photo.pk))

    def test_component_list_ordering(self):
        _, member_access = self._login_with_role("compordering@example.com", "Member")
        for name, quantity in [("Zener Diode", 3), ("Aileron Servo", 10), ("Motor Mount", 1)]:
            self.client.post(
                reverse("knowledge-component-list-create"),
                {"name": name, "quantity_available": quantity},
                format="json",
                **self._auth(member_access),
            )

        response = self.client.get(
            reverse("knowledge-component-list-create") + "?ordering=name", **self._auth(member_access)
        )
        self.assertEqual([c["name"] for c in response.data["results"]], ["Aileron Servo", "Motor Mount", "Zener Diode"])

        response = self.client.get(
            reverse("knowledge-component-list-create") + "?ordering=-quantity_available", **self._auth(member_access)
        )
        self.assertEqual([c["name"] for c in response.data["results"]], ["Aileron Servo", "Zener Diode", "Motor Mount"])

        # Unrecognized field - ignored rather than a 400, falling back to the default ordering.
        response = self.client.get(
            reverse("knowledge-component-list-create") + "?ordering=not_a_real_field", **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_component_rejects_photo_from_another_organization(self):
        _, member_access = self._login_with_role("compphotocross@example.com", "Member")
        other_organization = create_test_organization(name="Someone Else's Workshop")
        other_photo = StoredFile.objects.create(
            organization=other_organization,
            file=SimpleUploadedFile("part.png", b"fake-png-bytes", content_type="image/png"),
            original_filename="part.png",
            content_type="image/png",
            size=14,
        )
        response = self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Cross-Org Photo Attempt", "photo_id": str(other_photo.pk)},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_component_export_csv_respects_filters_and_visible_components(self):
        _, member_access = self._login_with_role("compexport@example.com", "Member")
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Certified Widget", "status": "CERTIFIED", "quantity_available": 5},
            format="json",
            **self._auth(member_access),
        )
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Testing Widget", "status": "TESTING", "quantity_available": 3},
            format="json",
            **self._auth(member_access),
        )

        response = self.client.get(reverse("knowledge-component-export"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv")
        body = response.getvalue().decode()
        self.assertIn("Certified Widget", body)
        self.assertIn("Testing Widget", body)

        response = self.client.get(
            reverse("knowledge-component-export") + "?status=CERTIFIED", **self._auth(member_access)
        )
        body = response.getvalue().decode()
        self.assertIn("Certified Widget", body)
        self.assertNotIn("Testing Widget", body)

    def test_component_export_requires_component_read(self):
        _, guest_access = self._login_with_role("compexportguest@example.com", "Guest")
        response = self.client.get(reverse("knowledge-component-export"), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_component_import_template_lists_expected_columns(self):
        _, member_access = self._login_with_role("compimporttemplate@example.com", "Member")
        response = self.client.get(reverse("knowledge-component-import-template"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv")
        header = response.getvalue().decode().splitlines()[0]
        self.assertEqual(
            header,
            "Name,Category,Manufacturer,Part Number,Link,Quantity Available,Status,Visibility,Tags,Summary,"
            "Specifications",
        )

    def _import_csv(self, access, csv_content: str, *, commit: bool):
        # A fresh SimpleUploadedFile per call - reusing one instance across
        # two posts (preview then commit) would send an already-exhausted
        # stream the second time, same as a real browser re-reading a File.
        upload = SimpleUploadedFile("components.csv", csv_content.encode(), content_type="text/csv")
        return self.client.post(
            reverse("knowledge-component-import"),
            {"file": upload, "commit": "true" if commit else "false"},
            format="multipart",
            **self._auth(access),
        )

    def test_component_import_preview_classifies_rows_without_writing_anything(self):
        _, mentor_access = self._login_with_role("compimportpreview@example.com", "Mentor")
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "ESC 40A", "quantity_available": 2, "status": "TESTING"},
            format="json",
            **self._auth(mentor_access),
        )
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Frame Kit", "quantity_available": 1},
            format="json",
            **self._auth(mentor_access),
        )
        csv_content = (
            "Name,Category,Manufacturer,Part Number,Link,Quantity Available,Status,Visibility,Tags,Summary,"
            "Specifications\n"
            "Brushless Motor,Propulsion,T-Motor,MN5212,,4,Testing,Public,\"motor, propulsion\",,"
            "\"KV: 340; Weight: 238g\"\n"  # new - create
            "ESC 40A,,,,,5,Certified,,,,\n"  # existing, quantity+status changed - update
            "Frame Kit,,,,,1,,,,,\n"  # existing, identical - unchanged
            ",Propulsion,,,,1,,,,,\n"  # missing Name - error
        )

        response = self._import_csv(mentor_access, csv_content, commit=False)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["summary"], {"create": 1, "update": 1, "unchanged": 1, "error": 1})
        self.assertNotIn("applied", response.data)
        rows_by_row_number = {row["row"]: row for row in response.data["rows"]}
        self.assertEqual(rows_by_row_number[2]["action"], "create")
        self.assertEqual(
            rows_by_row_number[3]["changes"],
            {
                "quantity_available": {"old": "2", "new": "5"},
                "status": {"old": "Testing", "new": "Certified"},
            },
        )
        self.assertEqual(rows_by_row_number[4]["action"], "unchanged")
        self.assertEqual(rows_by_row_number[5]["action"], "error")

        # Nothing was actually written - not the new component, not the
        # quantity/status change, and not the auto-created "Propulsion" category.
        self.assertFalse(Component.objects.filter(organization=self.organization, name="Brushless Motor").exists())
        self.assertEqual(Component.objects.get(organization=self.organization, name="ESC 40A").quantity_available, 2)
        self.assertFalse(Category.objects.filter(organization=self.organization, name__iexact="Propulsion").exists())

    def test_component_import_commit_applies_changes_and_leaves_blank_cells_alone(self):
        _, mentor_access = self._login_with_role("compimportcommit@example.com", "Mentor")
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "ESC 40A", "manufacturer": "Hobbywing", "quantity_available": 2, "status": "TESTING"},
            format="json",
            **self._auth(mentor_access),
        )
        csv_content = (
            "Name,Category,Manufacturer,Part Number,Link,Quantity Available,Status,Visibility,Tags,Summary,"
            "Specifications\n"
            "Brushless Motor,Propulsion,T-Motor,MN5212,,4,Testing,Public,\"motor, propulsion\",,"
            "\"KV: 340; Weight: 238g\"\n"
            "ESC 40A,,,,,5,Certified,,,,\n"  # Manufacturer left blank - should NOT clear Hobbywing
        )

        response = self._import_csv(mentor_access, csv_content, commit=True)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied"], {"created": 1, "updated": 1, "skipped": 0})

        created = Component.objects.get(organization=self.organization, name="Brushless Motor")
        self.assertEqual(created.manufacturer, "T-Motor")
        self.assertEqual(created.quantity_available, 4)
        self.assertEqual(created.specifications, [{"label": "KV", "value": "340"}, {"label": "Weight", "value": "238g"}])
        self.assertCountEqual([tag.name for tag in created.tags.all()], ["motor", "propulsion"])
        self.assertEqual(created.category, Category.objects.get(organization=self.organization, name__iexact="Propulsion"))

        updated = Component.objects.get(organization=self.organization, name="ESC 40A")
        self.assertEqual(updated.quantity_available, 5)
        self.assertEqual(updated.status, Component.Status.CERTIFIED)
        self.assertEqual(updated.manufacturer, "Hobbywing")  # untouched - blank cell, not cleared

    def test_component_import_reimporting_identical_data_creates_nothing(self):
        _, mentor_access = self._login_with_role("compimportidempotent@example.com", "Mentor")
        csv_content = "Name,Quantity Available,Status\nESC 40A,2,Testing\n"
        first = self._import_csv(mentor_access, csv_content, commit=True)
        self.assertEqual(first.data["applied"], {"created": 1, "updated": 0, "skipped": 0})

        second = self._import_csv(mentor_access, csv_content, commit=True)
        self.assertEqual(second.data["applied"], {"created": 0, "updated": 0, "skipped": 1})
        self.assertEqual(Component.objects.filter(organization=self.organization, name="ESC 40A").count(), 1)

    def test_component_import_update_requires_component_update_permission(self):
        _, member_access = self._login_with_role("compimportnoupdate@example.com", "Member")
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "ESC 40A", "quantity_available": 2},
            format="json",
            **self._auth(member_access),
        )
        csv_content = "Name,Quantity Available\nESC 40A,5\n"

        response = self._import_csv(member_access, csv_content, commit=True)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied"], {"created": 0, "updated": 0, "skipped": 0})
        self.assertEqual(response.data["summary"]["error"], 1)
        self.assertEqual(Component.objects.get(organization=self.organization, name="ESC 40A").quantity_available, 2)

    def test_component_import_requires_component_create(self):
        _, guest_access = self._login_with_role("compimportguest@example.com", "Guest")
        response = self._import_csv(guest_access, "Name\nWidget\n", commit=False)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_failure_crud_and_permission_gating(self):
        _, member_access = self._login_with_role("failmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "IMU Desync", "severity": "HIGH", "summary": "Desync during flight test."},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)  # Member has failure.create (pre-existing)
        failure = response.data
        self.assertEqual(failure["status"], "UNDER_INVESTIGATION")

        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure["id"]]),
            {"status": "RESOLVED"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no failure.update

        _, senior_access = self._login_with_role("failsenior@example.com", "Mentor")
        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure["id"]]),
            {"status": "RESOLVED", "root_cause": "Vibration-induced timestamp corruption."},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "RESOLVED")

        # failure.delete isn't granted below Organization Admin (pre-existing
        # catalogue - see seed_rbac.py) - Team Head still can't delete one.
        _, head_access = self._login_with_role("failhead@example.com", "Subteam Head")
        response = self.client.delete(reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("failadmin@example.com", "Organization Admin")
        response = self.client.delete(reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Failure.objects.exists())

    def test_failure_list_ordering(self):
        _, member_access = self._login_with_role("failordering@example.com", "Member")
        for title, severity in [("Zener Diode Failure", "LOW"), ("Antenna Snap", "HIGH"), ("Motor Mount Crack", "MEDIUM")]:
            self.client.post(
                reverse("knowledge-failure-list-create"),
                {"title": title, "severity": severity},
                format="json",
                **self._auth(member_access),
            )

        response = self.client.get(
            reverse("knowledge-failure-list-create") + "?ordering=title", **self._auth(member_access)
        )
        self.assertEqual(
            [f["title"] for f in response.data["results"]],
            ["Antenna Snap", "Motor Mount Crack", "Zener Diode Failure"],
        )

        response = self.client.get(
            reverse("knowledge-failure-list-create") + "?ordering=-severity", **self._auth(member_access)
        )
        # Alphabetical on the raw enum value (HIGH/LOW/MEDIUM), descending:
        # this endpoint sorts the stored code, not a display severity ranking.
        self.assertEqual(
            [f["title"] for f in response.data["results"]],
            ["Motor Mount Crack", "Zener Diode Failure", "Antenna Snap"],
        )

    def test_sop_create_requires_senior_member_not_just_member(self):
        _, member_access = self._login_with_role("sopmember@example.com", "Member")
        response = self.client.get(reverse("knowledge-sop-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)  # Member has sop.read

        response = self.client.post(
            reverse("knowledge-sop-list-create"),
            {"title": "IMU Calibration SOP", "mandatory": True, "content": "1. ..."},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no sop.create at Member tier

        _, senior_access = self._login_with_role("sopsenior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-sop-list-create"),
            {"title": "IMU Calibration SOP", "mandatory": True, "safety_notes": "Disconnect power first.", "content": "1. ..."},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["mandatory"])

    def test_test_crud_and_permission_gating(self):
        _, member_access = self._login_with_role("testmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-test-list-create"),
            {"title": "Thrust Stand Run 1", "test_type": "THRUST", "objective": "Measure static thrust."},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)  # Member has test.create
        test = response.data
        self.assertEqual(test["status"], "PLANNED")

        response = self.client.patch(
            reverse("knowledge-test-detail", args=[test["id"]]),
            {"status": "COMPLETED", "pass_fail": "PASS"},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no test.update

        _, senior_access = self._login_with_role("testsenior@example.com", "Mentor")
        response = self.client.patch(
            reverse("knowledge-test-detail", args=[test["id"]]),
            {"status": "COMPLETED", "pass_fail": "PASS", "results": "Thrust within spec."},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "COMPLETED")

        response = self.client.delete(reverse("knowledge-test-detail", args=[test["id"]]), **self._auth(senior_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no test.delete

        _, head_access = self._login_with_role("testhead@example.com", "Subteam Head")
        response = self.client.delete(reverse("knowledge-test-detail", args=[test["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Test.objects.exists())

    def test_test_list_ordering(self):
        _, member_access = self._login_with_role("testordering@example.com", "Member")
        for title, test_type in [("Zener Bench Test", "ELECTRICAL"), ("Autopilot Flight Test", "FLIGHT"), ("Motor Thrust Test", "THRUST")]:
            self.client.post(
                reverse("knowledge-test-list-create"),
                {"title": title, "test_type": test_type},
                format="json",
                **self._auth(member_access),
            )

        response = self.client.get(reverse("knowledge-test-list-create") + "?ordering=title", **self._auth(member_access))
        self.assertEqual(
            [t["title"] for t in response.data["results"]],
            ["Autopilot Flight Test", "Motor Thrust Test", "Zener Bench Test"],
        )

        response = self.client.get(
            reverse("knowledge-test-list-create") + "?ordering=-test_type", **self._auth(member_access)
        )
        # Alphabetical descending on the raw enum value: THRUST > FLIGHT > ELECTRICAL.
        self.assertEqual(
            [t["title"] for t in response.data["results"]],
            ["Motor Thrust Test", "Autopilot Flight Test", "Zener Bench Test"],
        )

    def test_test_relations_and_search(self):
        _, head_access = self._login_with_role("testrel@example.com", "Subteam Head")
        component = self.client.post(
            reverse("knowledge-component-list-create"), {"name": "Zephyrix ESC"}, format="json", **self._auth(head_access)
        ).data
        test = self.client.post(
            reverse("knowledge-test-list-create"),
            {"title": "Zephyrix ESC Bench Test", "objective": "Validate ESC thermal limits."},
            format="json",
            **self._auth(head_access),
        ).data

        response = self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "test", "source_id": test["id"], "target_type": "component", "target_id": component["id"]},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        test_relations = self.client.get(
            reverse("knowledge-test-relations", args=[test["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual([(r["other_type"], r["other_id"]) for r in test_relations], [("component", component["id"])])

        response = self.client.get(reverse("knowledge-search") + "?q=zephyrix", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("test", {r["type"] for r in response.data["results"]})
        self.assertEqual(response.data["counts"]["test"], 1)

    def test_relations_link_failure_to_component_and_sop_bidirectionally(self):
        _, head_access = self._login_with_role("relhead@example.com", "Subteam Head")
        component = self.client.post(
            reverse("knowledge-component-list-create"), {"name": "Pixhawk 6X"}, format="json", **self._auth(head_access)
        ).data
        sop = self.client.post(
            reverse("knowledge-sop-list-create"), {"title": "IMU Calibration SOP"}, format="json", **self._auth(head_access)
        ).data
        failure = self.client.post(
            reverse("knowledge-failure-list-create"), {"title": "IMU Desync"}, format="json", **self._auth(head_access)
        ).data

        for target_type, target_id in [("component", component["id"]), ("sop", sop["id"])]:
            response = self.client.post(
                reverse("knowledge-relation-create"),
                {"source_type": "failure", "source_id": failure["id"], "target_type": target_type, "target_id": target_id},
                format="json",
                **self._auth(head_access),
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        failure_relations = self.client.get(
            reverse("knowledge-failure-relations", args=[failure["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual({(r["other_type"], r["other_id"]) for r in failure_relations}, {("component", component["id"]), ("sop", sop["id"])})

        # Bidirectional - the component's own relation list shows the failure too.
        component_relations = self.client.get(
            reverse("knowledge-component-relations", args=[component["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual([(r["other_type"], r["other_id"]) for r in component_relations], [("failure", failure["id"])])

    def test_search_surfaces_all_four_engineering_types(self):
        _, head_access = self._login_with_role("searcheng@example.com", "Subteam Head")
        self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Zephyrix Project"}, format="json", **self._auth(head_access)
        )
        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Zephyrix Sensor"},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "Zephyrix Overheat", "summary": "..."},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-sop-list-create"), {"title": "Zephyrix Startup SOP"}, format="json", **self._auth(head_access)
        )

        response = self.client.get(reverse("knowledge-search") + "?q=zephyrix", **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        result_types = {r["type"] for r in response.data["results"]}
        self.assertEqual(result_types, {"project", "component", "failure", "sop"})
        self.assertEqual(
            {k: v for k, v in response.data["counts"].items() if k in ("project", "component", "failure", "sop")},
            {"project": 1, "component": 1, "failure": 1, "sop": 1},
        )

    def test_engineering_list_endpoints_support_q_search(self):
        """The per-page list filter (Projects/Components/Failures/SOPs pages'
        own search box, distinct from the global /knowledge/search/) - each
        list endpoint's own ?q= against its own icontains fields, not the
        cross-type search."""
        _, head_access = self._login_with_role("qsearcheng@example.com", "Subteam Head")

        self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "DBF 2027", "description": "..."},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Unrelated Rover"}, format="json", **self._auth(head_access)
        )
        response = self.client.get(reverse("knowledge-project-list-create") + "?q=dbf", **self._auth(head_access))
        self.assertEqual([p["name"] for p in response.data["results"]], ["DBF 2027"])

        self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Sensor Board", "manufacturer": "Holybro"},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-component-list-create"), {"name": "Unrelated Motor"}, format="json", **self._auth(head_access)
        )
        response = self.client.get(
            reverse("knowledge-component-list-create") + "?q=holybro", **self._auth(head_access)
        )
        self.assertEqual([c["name"] for c in response.data["results"]], ["Sensor Board"])

        self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "IMU Desync", "root_cause": "Vibration coupling"},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-failure-list-create"), {"title": "Unrelated Failure"}, format="json", **self._auth(head_access)
        )
        response = self.client.get(
            reverse("knowledge-failure-list-create") + "?q=vibration", **self._auth(head_access)
        )
        self.assertEqual([f["title"] for f in response.data["results"]], ["IMU Desync"])

        self.client.post(
            reverse("knowledge-sop-list-create"), {"title": "Thermal Calibration"}, format="json", **self._auth(head_access)
        )
        self.client.post(
            reverse("knowledge-sop-list-create"), {"title": "Unrelated SOP"}, format="json", **self._auth(head_access)
        )
        response = self.client.get(reverse("knowledge-sop-list-create") + "?q=thermal", **self._auth(head_access))
        self.assertEqual([s["title"] for s in response.data["results"]], ["Thermal Calibration"])


class UserProfileTests(KnowledgeTestCase):
    def test_profile_returns_public_fields_and_stats_not_roles_or_permissions(self):
        owner, owner_access = self._login_with_role("profileowner@example.com", "Subteam Head")
        article = self.client.post(
            reverse("knowledge-article-list-create"), {"title": "A", "content": "..."}, format="json", **self._auth(owner_access)
        ).data
        # Stats only count PUBLISHED articles (same rule visible_articles_for
        # applies everywhere else) - a draft shouldn't count toward the stat.
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(owner_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(owner_access))
        self.client.post(
            reverse("knowledge-project-list-create"), {"name": "P"}, format="json", **self._auth(owner_access)
        )
        question = self.client.post(
            reverse("knowledge-question-list-create"), {"title": "Q", "body": "..."}, format="json", **self._auth(owner_access)
        ).data

        viewer, viewer_access = self._login_with_role("profileviewer@example.com", "Member")
        answer = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "answer body"},
            format="json",
            **self._auth(viewer_access),
        ).data
        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(owner_access),
        )

        response = self.client.get(reverse("knowledge-user-profile", args=[owner.id]), **self._auth(viewer_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "profileowner@example.com")
        self.assertNotIn("roles", response.data)
        self.assertNotIn("permissions", response.data)
        self.assertEqual(
            {k: response.data["stats"][k] for k in ("article", "project", "question")},
            {"article": 1, "project": 1, "question": 1},
        )
        # article.create(3) + article.publish(5) + project.create(2) + question.create(1) - see scoring.py.
        # All contributions just happened, so "month"/"year"/"all" agree - and having just
        # scored the org's only points this period, the owner ranks #1 of 2 members in each.
        for period in ("month", "year", "all"):
            self.assertEqual(response.data["periods"][period]["score"], 11)
            self.assertEqual(response.data["periods"][period]["rank"], 1)
        self.assertEqual(response.data["total_members"], 2)

        # The viewer's own profile shows their answer, and that it was accepted.
        response = self.client.get(reverse("knowledge-user-profile", args=[viewer.id]), **self._auth(viewer_access))
        self.assertEqual(response.data["stats"]["answer"], 1)
        self.assertEqual(response.data["stats"]["accepted_answers"], 1)
        # question.answer(2) + accepted-answer credit(5), attributed to the
        # answer's own author (viewer), not the owner who clicked accept.
        # The viewer trails the owner's 11 points, so they rank #2 of 2 in every window.
        for period in ("month", "year", "all"):
            self.assertEqual(response.data["periods"][period]["score"], 7)
            self.assertEqual(response.data["periods"][period]["rank"], 2)

    def test_profile_404s_for_unknown_user(self):
        _, access = self._login_with_role("profile404@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-user-profile", args=["00000000-0000-0000-0000-000000000000"]), **self._auth(access)
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_profile_stats_and_contributions_hide_restricted_content_from_non_privileged_viewer(self):
        owner, owner_access = self._login_with_role("restrictedowner@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Private Q", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(owner_access),
        )

        _, other_access = self._login_with_role("restrictedviewer@example.com", "Member")
        response = self.client.get(reverse("knowledge-user-profile", args=[owner.id]), **self._auth(other_access))
        self.assertEqual(response.data["stats"]["question"], 0)

        response = self.client.get(
            reverse("knowledge-user-contributions", args=[owner.id]) + "?type=question", **self._auth(other_access)
        )
        self.assertEqual(response.data["count"], 0)

        # The owner sees their own restricted question in both places.
        response = self.client.get(reverse("knowledge-user-profile", args=[owner.id]), **self._auth(owner_access))
        self.assertEqual(response.data["stats"]["question"], 1)
        response = self.client.get(
            reverse("knowledge-user-contributions", args=[owner.id]) + "?type=question", **self._auth(owner_access)
        )
        self.assertEqual(response.data["count"], 1)

    def test_contributions_requires_a_known_type(self):
        owner, owner_access = self._login_with_role("contribtype@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-user-contributions", args=[owner.id]) + "?type=bogus", **self._auth(owner_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.get(reverse("knowledge-user-contributions", args=[owner.id]), **self._auth(owner_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class DocumentTests(KnowledgeTestCase):
    """Document is the one relatable type besides Article/Question with
    `visibility` - ownership-or-document.update gates edit/delete (see
    services.update_document/delete_document), same shape as
    question.moderate rather than a tiered CRUD-only scheme."""

    def test_document_create_and_ownership_gated_edit_delete(self):
        owner, owner_access = self._login_with_role("docowner@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-document-list-create"),
            {"title": "Competition Rules 2027", "doc_type": "REGULATION", "source": "EXTERNAL"},
            format="json",
            **self._auth(owner_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)  # Member has document.create
        document = response.data
        self.assertEqual(document["visibility"], "PUBLIC")

        # The owner can edit their own document without document.update.
        response = self.client.patch(
            reverse("knowledge-document-detail", args=[document["id"]]),
            {"description": "Official rules PDF."},
            format="json",
            **self._auth(owner_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Another Member (no document.update) can't edit or delete someone else's document.
        _, other_access = self._login_with_role("docother@example.com", "Member")
        response = self.client.patch(
            reverse("knowledge-document-detail", args=[document["id"]]),
            {"description": "Hijacked."},
            format="json",
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.delete(reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # A Mentor (document.update) can edit and delete someone else's document.
        _, senior_access = self._login_with_role("docsenior@example.com", "Mentor")
        response = self.client.patch(
            reverse("knowledge-document-detail", args=[document["id"]]),
            {"description": "Reviewed by a senior member."},
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.delete(reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(senior_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Document.objects.exists())

    def test_document_list_ordering(self):
        _, member_access = self._login_with_role("docordering@example.com", "Member")
        for title, doc_type in [("Zener Diode Datasheet", "DATASHEET"), ("Airframe Manual", "MANUAL"), ("Motor ESC Manual", "MANUAL")]:
            self.client.post(
                reverse("knowledge-document-list-create"),
                {"title": title, "doc_type": doc_type},
                format="json",
                **self._auth(member_access),
            )

        response = self.client.get(
            reverse("knowledge-document-list-create") + "?ordering=title", **self._auth(member_access)
        )
        self.assertEqual(
            [d["title"] for d in response.data["results"]],
            ["Airframe Manual", "Motor ESC Manual", "Zener Diode Datasheet"],
        )

    def test_restricted_document_hidden_from_list_search_and_relations(self):
        owner, owner_access = self._login_with_role("docrestowner@example.com", "Member")
        document = self.client.post(
            reverse("knowledge-document-list-create"),
            {"title": "Zephyrix Sponsor Budget", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(owner_access),
        ).data
        # Project creation needs project.create (Subteam Head only, see
        # EngineeringDomainTests) - a separate account from the document
        # owner just to get a project to relate to; the relation itself is
        # created from the document owner's side below, which only needs
        # edit rights on the *source* (the document), not the target.
        _, head_access = self._login_with_role("docresthead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Zephyrix Project"}, format="json", **self._auth(head_access)
        ).data
        self.client.post(
            reverse("knowledge-relation-create"),
            {"source_type": "document", "source_id": document["id"], "target_type": "project", "target_id": project["id"]},
            format="json",
            **self._auth(owner_access),
        )

        _, other_access = self._login_with_role("docrestother@example.com", "Member")

        # Not visible directly, in the list, in search, or as a relation's other side.
        response = self.client.get(reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.get(reverse("knowledge-document-list-create"), **self._auth(other_access))
        self.assertNotIn(document["id"], {d["id"] for d in response.data["results"]})
        response = self.client.get(reverse("knowledge-search") + "?q=zephyrix+sponsor", **self._auth(other_access))
        self.assertNotIn(document["id"], {r["id"] for r in response.data["results"] if r["type"] == "document"})
        response = self.client.get(reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(other_access))
        self.assertEqual(response.data, [])

        # The owner and a document.update holder can see it everywhere above.
        _, senior_access = self._login_with_role("docrestsenior@example.com", "Mentor")
        for access in (owner_access, senior_access):
            response = self.client.get(reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(access))
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            response = self.client.get(reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(access))
            self.assertEqual([r["other_id"] for r in response.data], [document["id"]])


class MultiTenancyIsolationTests(APITestCase):
    """Phase F of the multi-tenancy retrofit plan - a dedicated adversarial
    pass, not "every model has a filter so it must be fine." Two real,
    independent organizations (own RBAC catalogue, own users, own data),
    proving a logged-in user from Organization A cannot read, list, search,
    relate-to, or modify anything belonging to Organization B - by guessed
    id or otherwise - across every layer this retrofit touched: knowledge
    content, search, relations, files, and RBAC itself."""

    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Org A")
        cls.org_b = create_test_organization(name="Org B")

    def _login_with_role(self, email, role_name, organization):
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_knowledge_content_is_isolated(self):
        """One representative knowledge type (Article) - list, detail-by-id,
        and search all stay within the actor's own organization."""
        _, a_head_access = self._login_with_role("a-head@example.com", "Subteam Head", self.org_a)
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Org A Secret Battery Chemistry Notes", "content": "..."},
            format="json",
            **self._auth(a_head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(a_head_access))

        _, b_head_access = self._login_with_role("b-head@example.com", "Subteam Head", self.org_b)

        # Not in Org B's list.
        response = self.client.get(reverse("knowledge-article-list-create"), **self._auth(b_head_access))
        self.assertNotIn(article["id"], {a["id"] for a in response.data["results"]})

        # Not fetchable by id, even though it's PUBLISHED and PUBLIC (not RESTRICTED) -
        # org boundary applies regardless of visibility.
        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(b_head_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        # Not in Org B's search results.
        response = self.client.get(
            reverse("knowledge-search") + "?q=battery+chemistry", **self._auth(b_head_access)
        )
        self.assertNotIn(article["id"], {r["id"] for r in response.data["results"]})
        self.assertEqual(response.data["counts"]["article"], 0)

        # Org A's own head still sees it fine, unaffected by any of the above.
        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(a_head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_relation_creation_across_organizations_is_rejected(self):
        """The one place a cross-org link could otherwise sneak in via a
        guessed target UUID, since source and target resolve independently."""
        _, a_head_access = self._login_with_role("a-relhead@example.com", "Subteam Head", self.org_a)
        a_project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Org A Project"}, format="json", **self._auth(a_head_access)
        ).data

        _, b_head_access = self._login_with_role("b-relhead@example.com", "Subteam Head", self.org_b)
        b_project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Org B Project"}, format="json", **self._auth(b_head_access)
        ).data

        # Org B's head tries to relate their own project to Org A's project
        # by its (leaked/guessed) id - source ownership check would normally
        # pass (b_project is Org B's own), but target resolution must fail
        # since Org A's project doesn't exist *within Org B's organization*.
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "project",
                "source_id": b_project["id"],
                "target_type": "project",
                "target_id": a_project["id"],
            },
            format="json",
            **self._auth(b_head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(KnowledgeRelation.objects.count(), 0)

    def test_files_are_isolated(self):
        """Even holding file.read, Org B can't download or see Org A's file
        by id - required_permission alone says nothing about *whose* file it is."""
        _, a_member_access = self._login_with_role("a-filemember@example.com", "Member", self.org_a)
        upload = SimpleUploadedFile("org-a-secret.txt", b"org a only", content_type="text/plain")
        upload_response = self.client.post(
            reverse("files-upload"),
            {"file": upload, "required_permission": "file.read"},
            format="multipart",
            **self._auth(a_member_access),
        )
        file_id = upload_response.data["id"]

        _, b_member_access = self._login_with_role("b-filemember@example.com", "Member", self.org_b)
        response = self.client.get(reverse("files-download", args=[file_id]), **self._auth(b_member_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        # Org A's own uploader can still download it fine.
        response = self.client.get(reverse("files-download", args=[file_id]), **self._auth(a_member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_rbac_is_isolated(self):
        """Each org's RBAC admin manages only their own org's roles/users -
        role.manage/user.manage don't leak across organizations, and each
        org's seeded catalogue is independent (renaming one org's "Member"
        role never touches the other org's)."""
        _, a_admin_access = self._login_with_role("a-rbacadmin@example.com", "Organization Admin", self.org_a)
        _, b_admin_access = self._login_with_role("b-rbacadmin@example.com", "Organization Admin", self.org_b)

        a_member_role = Role.objects.get(organization=self.org_a, name="Member")

        # Org B's admin can't see, fetch, or rename Org A's "Member" role by
        # its (leaked/guessed) id - despite holding role.manage themselves.
        response = self.client.get(reverse("rbac-roles"), **self._auth(b_admin_access))
        self.assertNotIn(str(a_member_role.id), {r["id"] for r in response.data["results"]})

        response = self.client.get(reverse("rbac-role-detail", args=[a_member_role.id]), **self._auth(b_admin_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.patch(
            reverse("rbac-role-detail", args=[a_member_role.id]),
            {"name": "Hijacked"},
            format="json",
            **self._auth(b_admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        a_member_role.refresh_from_db()
        self.assertEqual(a_member_role.name, "Member")

        # Org B's admin also can't see Org A's users.
        b_user_ids = {
            u["id"]
            for u in self.client.get(reverse("rbac-users"), **self._auth(b_admin_access)).data["results"]
        }
        a_admin_id = str(User.objects.get(email="a-rbacadmin@example.com").id)
        self.assertNotIn(a_admin_id, b_user_ids)

        # Org A's own admin still manages their own role/users fine.
        response = self.client.get(reverse("rbac-role-detail", args=[a_member_role.id]), **self._auth(a_admin_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class ContributionScoringTests(KnowledgeTestCase):
    """Part 2 of the plan - weighted scoring (services.compute_contribution_scores_for),
    the org-scoped leaderboard endpoint, and the `contributors` field on
    detail serializers. See knowledge/scoring.py's own docstring for why
    accepted-answer points go to the answer's author, not whoever clicked accept."""

    def test_accepted_answer_credits_the_answers_author_not_the_acceptor(self):
        asker, asker_access = self._login_with_role("scoreasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Why does it beep?", "body": "It beeps a lot."},
            format="json",
            **self._auth(asker_access),
        ).data

        answerer, answerer_access = self._login_with_role("scoreanswerer@example.com", "Member")
        answer = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Try this."},
            format="json",
            **self._auth(answerer_access),
        ).data

        # Asker (not the answerer) clicks accept - the +5 must land on the
        # answerer, not the asker who merely performed the accept action.
        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(asker_access),
        )

        scores = services.compute_contribution_scores_for(self.organization)
        # asker: +1 for question.create only - no accept-answer credit.
        self.assertEqual(scores.get(asker.id), 1)
        # answerer: +2 for question.answer, +5 for being the accepted answer's author.
        self.assertEqual(scores.get(answerer.id), 7)

    def test_leaderboard_is_org_scoped_and_sorted_descending(self):
        prolific, prolific_access = self._login_with_role("scoreprolific@example.com", "Member")
        for i in range(3):
            self.client.post(
                reverse("knowledge-question-list-create"),
                {"title": f"Question {i}", "body": "..."},
                format="json",
                **self._auth(prolific_access),
            )
        quiet, quiet_access = self._login_with_role("scorequiet@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "One question", "body": "..."},
            format="json",
            **self._auth(quiet_access),
        )

        other_org = create_test_organization(name="Other Org For Leaderboard")
        other_user = User.objects.create_user(email="otherorgleader@example.com", password="password123", organization=other_org)
        Role.objects.get(organization=other_org, name="Member").user_roles.create(user=other_user)
        other_login = self.client.post(
            reverse("auth-login"), {"email": "otherorgleader@example.com", "password": "password123"}, format="json"
        ).data
        for i in range(10):
            self.client.post(
                reverse("knowledge-question-list-create"),
                {"title": f"Other org question {i}", "body": "..."},
                format="json",
                **self._auth(other_login["access"]),
            )

        response = self.client.get(reverse("knowledge-leaderboard"), **self._auth(prolific_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry_by_email = {entry["user"]["email"]: entry["score"] for entry in response.data}

        self.assertNotIn("otherorgleader@example.com", entry_by_email)
        self.assertEqual(entry_by_email["scoreprolific@example.com"], 3)
        self.assertEqual(entry_by_email["scorequiet@example.com"], 1)
        scores_in_order = [entry["score"] for entry in response.data]
        self.assertEqual(scores_in_order, sorted(scores_in_order, reverse=True))

    def test_leaderboard_period_param_filters_by_window_and_rejects_unknown_values(self):
        contributor, contributor_access = self._login_with_role("scoreperiod@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Just asked", "body": "..."},
            format="json",
            **self._auth(contributor_access),
        )

        for period in ("month", "year", "all"):
            response = self.client.get(
                reverse("knowledge-leaderboard") + f"?period={period}", **self._auth(contributor_access)
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            entry_by_email = {entry["user"]["email"]: entry["score"] for entry in response.data}
            # A contribution made moments ago always falls inside every window,
            # including "month"/"year" - it's the exclusion of older activity
            # (not covered here) that those windows exist for.
            self.assertEqual(entry_by_email["scoreperiod@example.com"], 1)

        response = self.client.get(
            reverse("knowledge-leaderboard") + "?period=decade", **self._auth(contributor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_contributors_field_lists_distinct_editors(self):
        author, author_access = self._login_with_role("scorearticleauthor@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Motor Notes", "content": "Body"},
            format="json",
            **self._auth(author_access),
        ).data

        _, senior_access = self._login_with_role("scorearticleeditor@example.com", "Mentor")
        self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"content": "Revised body"},
            format="json",
            **self._auth(senior_access),
        )

        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        contributor_emails = {c["email"] for c in response.data["contributors"]}
        self.assertEqual(contributor_emails, {"scorearticleauthor@example.com", "scorearticleeditor@example.com"})

    def test_user_activity_feed_is_scoped_to_the_target_user_and_organization(self):
        target, target_access = self._login_with_role("scoreactivitytarget@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Target's question", "body": "..."},
            format="json",
            **self._auth(target_access),
        )

        _, other_access = self._login_with_role("scoreactivityother@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Other's question", "body": "..."},
            format="json",
            **self._auth(other_access),
        )

        response = self.client.get(
            reverse("audit-user-activity", args=[target.id]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["action"], "question.create")

        other_org = create_test_organization(name="Other Org For Activity")
        outsider = User.objects.create_user(email="activityoutsider@example.com", password="password123", organization=other_org)
        Role.objects.get(organization=other_org, name="Member").user_roles.create(user=outsider)
        outsider_login = self.client.post(
            reverse("auth-login"), {"email": "activityoutsider@example.com", "password": "password123"}, format="json"
        ).data
        response = self.client.get(
            reverse("audit-user-activity", args=[target.id]), **self._auth(outsider_login["access"])
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class RestrictedAccessGrantTests(KnowledgeTestCase):
    """Project stands in for every visibility-bearing type here - the grant
    logic (services.add_restricted_access/remove_restricted_access) and the
    can_view_instance/exclude_inaccessible rule it feeds are shared code
    (knowledge/visibility.py), not per-type, so one representative type is
    enough to cover the mechanism; Document/Article/Question already have
    their own RESTRICTED coverage above."""

    def test_owner_can_grant_and_revoke_access(self):
        _, head_access = self._login_with_role("granthead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Restricted Airframe", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(head_access),
        ).data

        grantee, other_access = self._login_with_role("grantee@example.com", "Member")

        # Not visible yet - no grant, no override permission, not the owner.
        response = self.client.get(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(other_access))
        self.assertNotIn(project["id"], {p["id"] for p in response.data["results"]})

        # A non-owner without project.update can't grant access either.
        response = self.client.post(
            reverse("knowledge-access-grant-create"),
            {"content_type": "project", "object_id": project["id"], "user_id": str(grantee.id)},
            format="json",
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # The owner grants access.
        response = self.client.post(
            reverse("knowledge-access-grant-create"),
            {"content_type": "project", "object_id": project["id"], "user_id": str(grantee.id)},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        grant_id = response.data["id"]
        self.assertEqual(response.data["granted_user"]["email"], "grantee@example.com")

        response = self.client.get(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {g["user"]["email"] for g in response.data["restricted_to"]}, {"grantee@example.com"}
        )
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(other_access))
        self.assertIn(project["id"], {p["id"] for p in response.data["results"]})

        # Revoke it - back to inaccessible.
        response = self.client.delete(reverse("knowledge-access-grant-detail", args=[grant_id]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        response = self.client.get(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_org_admin_bypasses_restricted_visibility_without_a_grant(self):
        _, head_access = self._login_with_role("adminbypasshead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Admin Visible Airframe", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(head_access),
        ).data

        _, admin_access = self._login_with_role("adminbypass@example.com", "Organization Admin")
        response = self.client.get(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(admin_access))
        self.assertIn(project["id"], {p["id"] for p in response.data["results"]})
        self.assertEqual(RestrictedAccessGrant.objects.count(), 0)  # no grant needed


class BookmarkTests(KnowledgeTestCase):
    def test_bookmark_create_list_and_delete(self):
        _, head_access = self._login_with_role("bookmarkhead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Bookmarked Airframe"}, format="json", **self._auth(head_access)
        ).data

        _, member_access = self._login_with_role("bookmarkmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-bookmark-list-create"),
            {"content_type": "project", "object_id": project["id"]},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        bookmark_id = response.data["id"]
        self.assertEqual(response.data["type"], "project")
        self.assertEqual(response.data["title"], "Bookmarked Airframe")

        response = self.client.get(reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(member_access))
        self.assertEqual(response.data["bookmark_id"], bookmark_id)

        response = self.client.get(reverse("knowledge-bookmark-list-create"), **self._auth(member_access))
        self.assertEqual([b["id"] for b in response.data["results"]], [bookmark_id])

        response = self.client.delete(reverse("knowledge-bookmark-detail", args=[bookmark_id]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        response = self.client.get(reverse("knowledge-bookmark-list-create"), **self._auth(member_access))
        self.assertEqual(response.data["results"], [])

    def test_cannot_bookmark_inaccessible_restricted_content(self):
        _, head_access = self._login_with_role("bookmarkresthead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Unbookmarkable Airframe", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(head_access),
        ).data

        _, member_access = self._login_with_role("bookmarkrestmember@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-bookmark-list-create"),
            {"content_type": "project", "object_id": project["id"]},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Bookmark.objects.count(), 0)

    def test_bookmark_drops_out_of_list_once_target_turns_restricted(self):
        _, head_access = self._login_with_role("bookmarkdrophead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Later Restricted Airframe"}, format="json", **self._auth(head_access)
        ).data

        _, member_access = self._login_with_role("bookmarkdropmember@example.com", "Member")
        bookmark_id = self.client.post(
            reverse("knowledge-bookmark-list-create"),
            {"content_type": "project", "object_id": project["id"]},
            format="json",
            **self._auth(member_access),
        ).data["id"]

        self.client.patch(
            reverse("knowledge-project-detail", args=[project["id"]]),
            {"visibility": "RESTRICTED"},
            format="json",
            **self._auth(head_access),
        )

        response = self.client.get(reverse("knowledge-bookmark-list-create"), **self._auth(member_access))
        self.assertEqual(response.data["results"], [])
        # The row itself still exists - just excluded from the list, same
        # precedent as a relation's hidden "other side".
        self.assertTrue(Bookmark.objects.filter(id=bookmark_id).exists())


class CrossOrgAccessGrantAndBookmarkTests(APITestCase):
    """Same two-organization shape as MultiTenancyIsolationTests above (not
    a subclass of it - that would re-run its tests a second time under this
    class name) for the two new cross-org attack surfaces this feature set
    adds: a guessed-id grant, and a guessed-id bookmark."""

    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Org A Grants")
        cls.org_b = create_test_organization(name="Org B Grants")

    def _login_with_role(self, email, role_name, organization):
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_access_grant_cannot_target_a_user_in_another_organization(self):
        _, a_head_access = self._login_with_role("a-granthead@example.com", "Subteam Head", self.org_a)
        a_project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Org A Restricted Project", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(a_head_access),
        ).data

        b_user, _ = self._login_with_role("b-granttarget@example.com", "Member", self.org_b)

        response = self.client.post(
            reverse("knowledge-access-grant-create"),
            {"content_type": "project", "object_id": a_project["id"], "user_id": str(b_user.id)},
            format="json",
            **self._auth(a_head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(RestrictedAccessGrant.objects.count(), 0)

    def test_cannot_bookmark_content_in_another_organization_by_guessed_id(self):
        _, a_head_access = self._login_with_role("a-bookmarkhead@example.com", "Subteam Head", self.org_a)
        a_project = self.client.post(
            reverse("knowledge-project-list-create"), {"name": "Org A Project To Guess"}, format="json", **self._auth(a_head_access)
        ).data

        _, b_member_access = self._login_with_role("b-bookmarkmember@example.com", "Member", self.org_b)
        response = self.client.post(
            reverse("knowledge-bookmark-list-create"),
            {"content_type": "project", "object_id": a_project["id"]},
            format="json",
            **self._auth(b_member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Bookmark.objects.count(), 0)
