import datetime
import uuid
from unittest import mock

from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.models import Q, QuerySet
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from audit.models import AuditLog
from core.testing import RoleLoginMixin, create_test_organization
from files.models import StoredFile
from rbac.models import Role

from . import services, trash
from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Bookmark,
    Category,
    Collection,
    CollectionItem,
    Component,
    ComponentCategory,
    Document,
    Failure,
    KnowledgeRelation,
    Project,
    Question,
    QuestionAttachment,
    RestrictedAccessGrant,
    ShareLink,
    Sop,
    StorageLocation,
    Tag,
    Test,
    Visibility,
)


class KnowledgeTestCase(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

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
        response = self.client.post(reverse("knowledge-article-submit", args=[article_id]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(reverse("knowledge-article-submit", args=[article_id]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Article.Status.IN_REVIEW)

        # Submitting again is invalid - 400, not a 500.
        response = self.client.post(reverse("knowledge-article-submit", args=[article_id]), **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        _, senior_access = self._login_with_role("senior@example.com", "Mentor")
        response = self.client.post(
            reverse("knowledge-article-publish", args=[article_id]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        response = self.client.post(reverse("knowledge-article-publish", args=[article_id]), **self._auth(head_access))
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

    def test_answer_without_a_body_is_a_validation_error(self):
        asker, asker_access = self._login_with_role("asker-nobody@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Why does it beep?", "body": "It beeps a lot."},
            format="json",
            **self._auth(asker_access),
        ).data

        response = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {},
            format="json",
            **self._auth(asker_access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

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

    def test_editing_answer_without_body_is_rejected(self):
        asker, asker_access = self._login_with_role("asker4@example.com", "Member")
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

        response = self.client.patch(
            reverse("knowledge-answer-detail", args=[answer["id"]]), {}, format="json", **self._auth(asker_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.patch(
            reverse("knowledge-answer-detail", args=[answer["id"]]),
            {"body": "Edited"},
            format="json",
            **self._auth(asker_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["body"], "Edited")


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

    def test_duplicate_category_name_is_a_400_not_a_500(self):
        _, admin_access = self._login_with_role("categdupe@example.com", "Organization Admin")
        url = reverse("knowledge-category-list")
        first = self.client.post(url, {"name": "Aero"}, format="json", **self._auth(admin_access))
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        other = self.client.post(url, {"name": "Structures"}, format="json", **self._auth(admin_access))

        response = self.client.post(url, {"name": "aero"}, format="json", **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)

        detail = reverse("knowledge-category-detail", args=[other.data["id"]])
        response = self.client.patch(detail, {"name": "Aero"}, format="json", **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Saving a category under its own name is not a clash.
        response = self.client.patch(detail, {"name": "Structures"}, format="json", **self._auth(admin_access))
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
        self.client.post(reverse("knowledge-article-submit", args=[other_published["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-publish", args=[other_published["id"]]), **self._auth(head_access))

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

    def _revisioned_draft(self, email):
        author, access = self._login_with_role(email, "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Title V1", "content": "V1"},
            format="json",
            **self._auth(access),
        ).data
        self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"title": "Title V2", "content": "V2"},
            format="json",
            **self._auth(access),
        )
        revisions = self.client.get(reverse("knowledge-article-revisions", args=[article["id"]]), **self._auth(access))
        return author, access, article, revisions.data

    def test_restore_revision_brings_back_old_version_as_a_new_revision(self):
        author, access, article, revisions = self._revisioned_draft("restoreauthor@example.com")
        oldest = revisions[-1]
        response = self.client.post(
            reverse("knowledge-article-revision-restore", args=[article["id"], oldest["id"]]), **self._auth(access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["title"], "Title V1")
        self.assertEqual(response.data["content"], "V1")
        # History grows rather than being rewound (newest first): restored V1, V2, original V1.
        after = self.client.get(reverse("knowledge-article-revisions", args=[article["id"]]), **self._auth(access))
        self.assertEqual([r["content"] for r in after.data], ["V1", "V2", "V1"])
        self.assertTrue(
            AuditLog.objects.filter(action="article.restore_revision", target_object_id=str(article["id"])).exists()
        )

    def test_restore_of_current_version_is_rejected(self):
        _, access, article, revisions = self._revisioned_draft("restorecurrent@example.com")
        response = self.client.post(
            reverse("knowledge-article-revision-restore", args=[article["id"], revisions[0]["id"]]),
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_restore_follows_edit_rules(self):
        _, access, article, revisions = self._revisioned_draft("restorerules@example.com")
        _, other_access = self._login_with_role("restoreother@example.com", "Member")
        url = reverse("knowledge-article-revision-restore", args=[article["id"], revisions[-1]["id"]])
        # Someone who can't even see the draft gets the same answer as for the article itself.
        self.assertEqual(self.client.post(url, **self._auth(other_access)).status_code, status.HTTP_403_FORBIDDEN)

        # A revision id from a different article is a 404, not a cross-article restore.
        _, _, other_article, other_revisions = self._revisioned_draft("restoreforeign@example.com")
        foreign = reverse("knowledge-article-revision-restore", args=[article["id"], other_revisions[-1]["id"]])
        self.assertEqual(self.client.post(foreign, **self._auth(access)).status_code, status.HTTP_404_NOT_FOUND)

        # Archived articles stay frozen, restore included.
        Article.objects.filter(pk=article["id"]).update(status=Article.Status.ARCHIVED)
        self.assertEqual(self.client.post(url, **self._auth(access)).status_code, status.HTTP_400_BAD_REQUEST)


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
        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.data["status"], Question.Status.ANSWERED)

        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": answer["id"]},
            format="json",
            **self._auth(asker_access),
        )
        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.data["status"], Question.Status.SOLVED)

        self.client.post(
            reverse("knowledge-question-accept", args=[question["id"]]),
            {"answer_id": None},
            format="json",
            **self._auth(asker_access),
        )
        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access)
        )
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
        response = self.client.post(
            reverse("knowledge-question-close", args=[question["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-question-close", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Question.Status.CLOSED)

        response = self.client.post(
            reverse("knowledge-answer-list-create", args=[question["id"]]),
            {"body": "Too late"},
            format="json",
            **self._auth(other_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            reverse("knowledge-question-reopen", args=[question["id"]]), **self._auth(asker_access)
        )
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

        response = self.client.post(
            reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access)
        )
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
        response = self.client.post(
            reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(guest_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("Check the power supply", response.data["content"])
        article_id = response.data["id"]

        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.data["promoted_to_article"], article_id)

        # Already promoted - a second attempt is rejected rather than creating a duplicate article.
        response = self.client.post(
            reverse("knowledge-question-promote", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ListQueryCountTests(KnowledgeTestCase):
    """Category article counts, question answer counts (and the category nested
    in every article row) used to cost a query per row. The query count of a
    list must not grow with its length."""

    def _count(self, access, url):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
        self.client.credentials()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return len(ctx.captured_queries), response

    def _add_rows(self, access, start, stop):
        for i in range(start, stop):
            category = self.client.post(
                reverse("knowledge-category-list"), {"name": f"Cat {i}"}, format="json", **self._auth(access)
            ).data
            article = self.client.post(
                reverse("knowledge-article-list-create"),
                {"title": f"Article {i}", "content": "x", "category_id": category["id"]},
                format="json",
                **self._auth(access),
            ).data
            self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(access))
            question = self.client.post(
                reverse("knowledge-question-list-create"),
                {"title": f"Question {i}?", "body": "x"},
                format="json",
                **self._auth(access),
            ).data
            self.client.post(
                reverse("knowledge-answer-list-create", args=[question["id"]]),
                {"body": "y"},
                format="json",
                **self._auth(access),
            )
            for name, payload in (
                ("knowledge-component-list-create", {"name": f"Servo {i}", "summary": "long text"}),
                ("knowledge-failure-list-create", {"title": f"Failure {i}", "summary": "s", "root_cause": "r"}),
                ("knowledge-sop-list-create", {"title": f"SOP {i}", "content": "steps"}),
                ("knowledge-test-list-create", {"title": f"Test {i}", "objective": "o", "results": "r"}),
                ("knowledge-document-list-create", {"title": f"Doc {i}", "description": "d"}),
            ):
                response = self.client.post(reverse(name), payload, format="json", **self._auth(access))
                self.assertEqual(response.status_code, status.HTTP_201_CREATED, (name, response.data))

    def test_list_query_counts_do_not_grow_with_rows(self):
        _, admin_access = self._login_with_role("listcount@example.com", "Organization Admin")
        urls = (
            reverse("knowledge-category-list"),
            reverse("knowledge-article-list-create"),
            reverse("knowledge-question-list-create"),
            # Also guards the deferred body/search columns (views._LIST_DEFERRED_FIELDS):
            # a list serializer reading one would add a query per row here.
            reverse("knowledge-component-list-create"),
            reverse("knowledge-failure-list-create"),
            reverse("knowledge-sop-list-create"),
            reverse("knowledge-test-list-create"),
            reverse("knowledge-document-list-create"),
        )
        self._add_rows(admin_access, 0, 2)
        small = {url: self._count(admin_access, url)[0] for url in urls}
        self._add_rows(admin_access, 2, 6)
        for url in urls:
            large, response = self._count(admin_access, url)
            self.assertEqual(large, small[url], f"{url}: {small[url]} queries for 2 rows, {large} for 6")

        categories = self._count(admin_access, urls[0])[1].data["results"]
        self.assertTrue(all(category["article_count"] == 1 for category in categories))
        questions = self._count(admin_access, urls[2])[1].data["results"]
        self.assertTrue(all(question["answer_count"] == 1 for question in questions))


class SearchQueryBudgetTests(KnowledgeTestCase):
    """Search used to cost ~45 queries per keystroke (8 counts + 8 pages + 8
    exists + ~20 permission lookups). Guards the slimmed-down version."""

    def _search_query_count(self, access, params):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(reverse("knowledge-search") + params)
        self.client.credentials()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return len(ctx.captured_queries), response

    def test_dropdown_search_skips_counts_and_stays_cheap(self):
        _, head_access = self._login_with_role("searchbudget@example.com", "Subteam Head")
        for i in range(25):
            self.client.post(
                reverse("knowledge-project-list-create"),
                {"name": f"Wing spar {i}"},
                format="json",
                **self._auth(head_access),
            )
        full, response = self._search_query_count(head_access, "?q=wing")
        self.assertIsNotNone(response.data["counts"])
        self.assertTrue(response.data["has_more"])
        self.assertEqual(len(response.data["results"]), 20)

        quick, response = self._search_query_count(head_access, "?q=wing&counts=false")
        self.assertIsNone(response.data["counts"])
        self.assertTrue(response.data["has_more"])
        self.assertEqual(len(response.data["results"]), 20)
        # Skipping counts removes the 8 COUNT queries.
        self.assertEqual(full - quick, 8)
        self.assertLessEqual(quick, 15, f"dropdown search ran {quick} queries")


class SearchTests(KnowledgeTestCase):
    def test_result_excerpts_are_plain_text_not_markdown_source(self):
        _, access = self._login_with_role("snippetauthor@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Snippet check", "body": "We had [a thermal event](/failures/123) - is there a **checklist**?"},
            format="json",
            **self._auth(access),
        )
        response = self.client.get(reverse("knowledge-search"), {"q": "Snippet check"}, **self._auth(access))
        result = next(r for r in response.data["results"] if r["title"] == "Snippet check")
        self.assertEqual(result["excerpt"], "We had a thermal event - is there a checklist?")

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

        response = self.client.get(
            reverse("knowledge-search") + "?q=pixhawk&type=question", **self._auth(author_access)
        )
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
        response = self.client.get(reverse("knowledge-search") + "?q=confidential", **self._auth(other_access))
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
        self.client.post(
            reverse("knowledge-article-publish", args=[other_article["id"]]), **self._auth(other_head_access)
        )
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
        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Not in the published list either.
        response = self.client.get(reverse("knowledge-article-list-create"), **self._auth(other_access))
        self.assertNotIn(article["id"], {a["id"] for a in response.data["results"]})

        # But the author and a reviewer/publisher can still see it.
        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(author_access)
        )
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
        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def _restricted_question(self, author_access):
        return self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Private Q", "body": "...", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(author_access),
        ).data

    def test_restricted_question_answers_are_hidden_and_closed_to_outsiders(self):
        # Answers have no visibility of their own - they inherit the
        # question's. The answers endpoint used to look the question up by
        # org only, so anyone could read and post there.
        _, author_access = self._login_with_role("ansauthor@example.com", "Member")
        question = self._restricted_question(author_access)
        answers_url = reverse("knowledge-answer-list-create", args=[question["id"]])
        response = self.client.post(
            answers_url, {"body": "Owner's own answer"}, format="json", **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        _, other_access = self._login_with_role("ansother@example.com", "Member")
        self.assertEqual(
            self.client.get(answers_url, **self._auth(other_access)).status_code, status.HTTP_403_FORBIDDEN
        )
        response = self.client.post(answers_url, {"body": "Outsider"}, format="json", **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(answers_url, **self._auth(author_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_cannot_relate_own_item_to_a_restricted_target_you_cannot_see(self):
        _, author_access = self._login_with_role("relrauthor@example.com", "Member")
        question = self._restricted_question(author_access)

        _, other_access = self._login_with_role("relrother@example.com", "Member")
        own_article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Mine", "content": "Body"},
            format="json",
            **self._auth(other_access),
        ).data
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "article",
                "source_id": own_article["id"],
                "target_type": "question",
                "target_id": question["id"],
            },
            format="json",
            **self._auth(other_access),
        )
        # Same "not found" 400 as a nonexistent id - no existence/title leak.
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn("Private Q", str(response.data))

    def test_restricted_items_attachments_cannot_be_downloaded_by_outsiders(self):
        _, author_access = self._login_with_role("dlauthor@example.com", "Member")
        question = self._restricted_question(author_access)
        file_id = self.client.post(
            reverse("files-upload"),
            {"file": SimpleUploadedFile("secret.txt", b"secret contents")},
            format="multipart",
            **self._auth(author_access),
        ).data["id"]
        response = self.client.post(
            reverse("knowledge-question-attachment-list", args=[question["id"]]),
            {"file_id": file_id},
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        download_url = reverse("files-download", args=[file_id])
        _, other_access = self._login_with_role("dlother@example.com", "Member")
        self.assertEqual(
            self.client.get(download_url, **self._auth(other_access)).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(self.client.get(download_url, **self._auth(author_access)).status_code, status.HTTP_200_OK)


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
            {
                "source_type": "article",
                "source_id": article_a["id"],
                "target_type": "article",
                "target_id": article_b["id"],
            },
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["other_type"], "article")
        self.assertEqual(response.data["other_id"], article_b["id"])
        relation_id = response.data["id"]

        # Visible from both sides, each showing "the other one".
        response = self.client.get(
            reverse("knowledge-article-relations", args=[article_a["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.data[0]["other_id"], article_b["id"])
        response = self.client.get(
            reverse("knowledge-article-relations", args=[article_b["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.data[0]["other_id"], article_a["id"])

        # Duplicate creation is idempotent (get_or_create), not an error or a second row.
        self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "article",
                "source_id": article_a["id"],
                "target_type": "article",
                "target_id": article_b["id"],
            },
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(KnowledgeRelation.objects.count(), 1)

        _, other_access = self._login_with_role("relother@example.com", "Member")
        response = self.client.delete(
            reverse("knowledge-relation-detail", args=[relation_id]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(
            reverse("knowledge-relation-detail", args=[relation_id]), **self._auth(author_access)
        )
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
            {
                "source_type": "article",
                "source_id": article["id"],
                "target_type": "question",
                "target_id": question["id"],
            },
            format="json",
            **self._auth(author_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # A viewer with no relationship to the restricted question can see the
        # (public) article's relations endpoint at all, but the restricted
        # question must not appear in the list - not its title, not its id.
        _, other_access = self._login_with_role("relvisother@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

        # The question's own author still sees it.
        response = self.client.get(
            reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(author_access)
        )
        self.assertEqual([r["other_id"] for r in response.data], [question["id"]])

        # So does a question.moderate holder who isn't the author.
        _, moderator_access = self._login_with_role("relvismod@example.com", "Mentor")
        response = self.client.get(
            reverse("knowledge-article-relations", args=[article["id"]]), **self._auth(moderator_access)
        )
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
            {
                "source_type": "article",
                "source_id": article["id"],
                "target_type": "article",
                "target_id": article["id"],
            },
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
            {
                "source_type": "question",
                "source_id": question["id"],
                "target_type": "article",
                "target_id": article["id"],
            },
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
            reverse("knowledge-sop-list-create"),
            {"title": "Preflight Checklist"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-article-list-create"),
            {"title": "A", "content": "..."},
            format="json",
            **self._auth(author_access),
        ).data
        article_b = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "B", "content": "..."},
            format="json",
            **self._auth(author_access),
        ).data
        response = self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "article",
                "source_id": article_a["id"],
                "target_type": "article",
                "target_id": article_b["id"],
            },
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

        response = self.client.delete(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)  # no project.delete

        response = self.client.delete(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.exists())

    def test_project_list_includes_excerpt_and_visible_linked_counts(self):
        project = Project.objects.create(
            organization=self.organization,
            name="DBF 2027",
            description="**Season** aircraft - see [the plan](/knowledge/articles/x).",
        )
        Test.objects.create(organization=self.organization, title="Static thrust", project=project)
        Test.objects.create(organization=self.organization, title="Range", project=project)
        Failure.objects.create(organization=self.organization, title="Public failure", project=project)
        # Restricted with no grants - a Member can't see it, so it must not be counted either.
        Failure.objects.create(
            organization=self.organization, title="Hidden failure", project=project, visibility="RESTRICTED"
        )

        _, member_access = self._login_with_role("projcounts@example.com", "Member")
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(item for item in response.data["results"] if item["id"] == str(project.id))
        self.assertEqual(row["excerpt"], "Season aircraft - see the plan.")
        self.assertEqual(row["test_count"], 2)
        self.assertEqual(row["failure_count"], 1)

    def test_project_list_collaborators_are_creators_of_visible_related_items(self):
        owner, _ = self._login_with_role("projowner@example.com", "Subteam Head")
        busy, _ = self._login_with_role("projbusy@example.com", "Member")
        hidden_author, _ = self._login_with_role("projhidden@example.com", "Member")
        project = Project.objects.create(organization=self.organization, name="Fuselage", created_by=owner)
        project_ct = ContentType.objects.get_for_model(Project)

        def relate(item, *, project_is_source):
            item_ct = ContentType.objects.get_for_model(type(item))
            ends = [(project_ct, project.id), (item_ct, item.id)]
            if not project_is_source:
                ends.reverse()
            (source_ct, source_id), (target_ct, target_id) = ends
            KnowledgeRelation.objects.create(
                organization=self.organization,
                source_content_type=source_ct,
                source_object_id=source_id,
                target_content_type=target_ct,
                target_object_id=target_id,
            )

        # `busy` made two related items (one linked each direction) - ranked ahead of the owner's one.
        relate(
            Component.objects.create(organization=self.organization, name="Spar", created_by=busy),
            project_is_source=True,
        )
        relate(
            Sop.objects.create(organization=self.organization, title="Layup", created_by=busy), project_is_source=False
        )
        # Only related item by this person is restricted - they must not appear for a Member.
        relate(
            Document.objects.create(
                organization=self.organization, title="Secret", created_by=hidden_author, visibility="RESTRICTED"
            ),
            project_is_source=True,
        )

        _, viewer_access = self._login_with_role("projviewer@example.com", "Member")
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(viewer_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(item for item in response.data["results"] if item["id"] == str(project.id))
        self.assertEqual([person["id"] for person in row["collaborators"]], [str(busy.id), str(owner.id)])
        self.assertEqual(row["collaborator_count"], 2)

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
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertTrue(response.getvalue().startswith("\ufeff".encode()))  # BOM - Excel reads it as UTF-8
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
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        header = response.getvalue().decode("utf-8-sig").splitlines()[0]
        self.assertEqual(header.split(","), services.INVENTORY_CSV_COLUMNS)

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
            'Brushless Motor,Propulsion,T-Motor,MN5212,,4,Testing,Public,"motor, propulsion",,'
            '"KV: 340; Weight: 238g"\n'  # new - create
            "ESC 40A,,,,,5,Certified,,,,\n"  # existing, quantity+status changed - update
            "Frame Kit,,,,,1,,,,,\n"  # existing, identical - unchanged
            ",Propulsion,,,,1,,,,,\n"  # missing Name - error
        )

        response = self._import_csv(mentor_access, csv_content, commit=False)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["summary"],
            {"create": 1, "update": 1, "unchanged": 1, "error": 1, "merged": 0, "duplicate_groups": 0},
        )
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
        self.assertFalse(
            ComponentCategory.objects.filter(organization=self.organization, name__iexact="Propulsion").exists()
        )

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
            'Brushless Motor,Propulsion,T-Motor,MN5212,,4,Testing,Public,"motor, propulsion",,'
            '"KV: 340; Weight: 238g"\n'
            "ESC 40A,,,,,5,Certified,,,,\n"  # Manufacturer left blank - should NOT clear Hobbywing
        )

        response = self._import_csv(mentor_access, csv_content, commit=True)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied"], {"created": 1, "updated": 1, "skipped": 0})

        created = Component.objects.get(organization=self.organization, name="Brushless Motor")
        self.assertEqual(created.manufacturer, "T-Motor")
        self.assertEqual(created.quantity_available, 4)
        self.assertEqual(
            created.specifications, [{"label": "KV", "value": "340"}, {"label": "Weight", "value": "238g"}]
        )
        self.assertCountEqual([tag.name for tag in created.tags.all()], ["motor", "propulsion"])
        self.assertEqual(
            created.category, ComponentCategory.objects.get(organization=self.organization, name__iexact="Propulsion")
        )
        # Components' categories are their own list - nothing leaks into the knowledge categories.
        self.assertFalse(Category.objects.filter(organization=self.organization, name__iexact="Propulsion").exists())

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
        response = self.client.delete(
            reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("failadmin@example.com", "Organization Admin")
        response = self.client.delete(
            reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(admin_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Failure.objects.exists())

    def test_failure_list_ordering(self):
        _, member_access = self._login_with_role("failordering@example.com", "Member")
        for title, severity in [
            ("Zener Diode Failure", "LOW"),
            ("Antenna Snap", "HIGH"),
            ("Motor Mount Crack", "MEDIUM"),
        ]:
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
            {
                "title": "IMU Calibration SOP",
                "mandatory": True,
                "safety_notes": "Disconnect power first.",
                "content": "1. ...",
            },
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["mandatory"])

    def test_sop_co_authors_can_be_assigned_and_can_edit(self):
        mentor, senior_access = self._login_with_role("sopsenior2@example.com", "Mentor")
        co_author, coauthor_access = self._login_with_role("sopcoauthor@example.com", "Member")
        response = self.client.post(
            reverse("knowledge-sop-list-create"),
            {
                "title": "Battery Charging SOP",
                "mandatory": False,
                "content": "Step 1",
                "co_author_ids": [str(co_author.pk)],
            },
            format="json",
            **self._auth(senior_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        sop_id = response.data["id"]
        self.assertEqual(len(response.data["co_authors"]), 1)
        self.assertEqual(response.data["co_authors"][0]["id"], str(co_author.pk))

        response = self.client.patch(
            reverse("knowledge-sop-detail", args=[sop_id]),
            {"content": "Step 1 updated by co-author"},
            format="json",
            **self._auth(coauthor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["content"], "Step 1 updated by co-author")

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
        for title, test_type in [
            ("Zener Bench Test", "ELECTRICAL"),
            ("Autopilot Flight Test", "FLIGHT"),
            ("Motor Thrust Test", "THRUST"),
        ]:
            self.client.post(
                reverse("knowledge-test-list-create"),
                {"title": title, "test_type": test_type},
                format="json",
                **self._auth(member_access),
            )

        response = self.client.get(
            reverse("knowledge-test-list-create") + "?ordering=title", **self._auth(member_access)
        )
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
            reverse("knowledge-component-list-create"),
            {"name": "Zephyrix ESC"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-sop-list-create"),
            {"title": "IMU Calibration SOP"},
            format="json",
            **self._auth(head_access),
        ).data
        failure = self.client.post(
            reverse("knowledge-failure-list-create"), {"title": "IMU Desync"}, format="json", **self._auth(head_access)
        ).data

        for target_type, target_id in [("component", component["id"]), ("sop", sop["id"])]:
            response = self.client.post(
                reverse("knowledge-relation-create"),
                {
                    "source_type": "failure",
                    "source_id": failure["id"],
                    "target_type": target_type,
                    "target_id": target_id,
                },
                format="json",
                **self._auth(head_access),
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        failure_relations = self.client.get(
            reverse("knowledge-failure-relations", args=[failure["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual(
            {(r["other_type"], r["other_id"]) for r in failure_relations},
            {("component", component["id"]), ("sop", sop["id"])},
        )

        # Bidirectional - the component's own relation list shows the failure too.
        component_relations = self.client.get(
            reverse("knowledge-component-relations", args=[component["id"]]), **self._auth(head_access)
        ).data
        self.assertEqual([(r["other_type"], r["other_id"]) for r in component_relations], [("failure", failure["id"])])

    def test_search_surfaces_all_four_engineering_types(self):
        _, head_access = self._login_with_role("searcheng@example.com", "Subteam Head")
        self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Zephyrix Project"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-sop-list-create"),
            {"title": "Zephyrix Startup SOP"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-project-list-create"),
            {"name": "Unrelated Rover"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-component-list-create"),
            {"name": "Unrelated Motor"},
            format="json",
            **self._auth(head_access),
        )
        response = self.client.get(reverse("knowledge-component-list-create") + "?q=holybro", **self._auth(head_access))
        self.assertEqual([c["name"] for c in response.data["results"]], ["Sensor Board"])

        self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "IMU Desync", "root_cause": "Vibration coupling"},
            format="json",
            **self._auth(head_access),
        )
        self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "Unrelated Failure"},
            format="json",
            **self._auth(head_access),
        )
        response = self.client.get(reverse("knowledge-failure-list-create") + "?q=vibration", **self._auth(head_access))
        self.assertEqual([f["title"] for f in response.data["results"]], ["IMU Desync"])

        self.client.post(
            reverse("knowledge-sop-list-create"),
            {"title": "Thermal Calibration"},
            format="json",
            **self._auth(head_access),
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
            reverse("knowledge-article-list-create"),
            {"title": "A", "content": "..."},
            format="json",
            **self._auth(owner_access),
        ).data
        # Stats only count PUBLISHED articles (same rule visible_articles_for
        # applies everywhere else) - a draft shouldn't count toward the stat.
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(owner_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(owner_access))
        self.client.post(
            reverse("knowledge-project-list-create"), {"name": "P"}, format="json", **self._auth(owner_access)
        )
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Q", "body": "..."},
            format="json",
            **self._auth(owner_access),
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
        self.assertEqual(response.data["id"], str(owner.id))
        # Visible to other members by default (User.email_visible).
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
        response = self.client.delete(
            reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(other_access)
        )
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
        response = self.client.delete(
            reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Document.objects.exists())

    def test_document_list_ordering(self):
        _, member_access = self._login_with_role("docordering@example.com", "Member")
        for title, doc_type in [
            ("Zener Diode Datasheet", "DATASHEET"),
            ("Airframe Manual", "MANUAL"),
            ("Motor ESC Manual", "MANUAL"),
        ]:
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
        # Project creation needs project.create (Subteam Head only), so a separate account makes the
        # project. The relation is created from the document owner's side, which only needs edit
        # rights on the *source* (the document), not the target.
        _, head_access = self._login_with_role("docresthead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Zephyrix Project"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(
            reverse("knowledge-relation-create"),
            {
                "source_type": "document",
                "source_id": document["id"],
                "target_type": "project",
                "target_id": project["id"],
            },
            format="json",
            **self._auth(owner_access),
        )

        _, other_access = self._login_with_role("docrestother@example.com", "Member")

        # Not visible directly, in the list, in search, or as a relation's other side.
        response = self.client.get(
            reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        response = self.client.get(reverse("knowledge-document-list-create"), **self._auth(other_access))
        self.assertNotIn(document["id"], {d["id"] for d in response.data["results"]})
        response = self.client.get(reverse("knowledge-search") + "?q=zephyrix+sponsor", **self._auth(other_access))
        self.assertNotIn(document["id"], {r["id"] for r in response.data["results"] if r["type"] == "document"})
        response = self.client.get(
            reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.data, [])

        # The owner and a document.update holder can see it everywhere above.
        _, senior_access = self._login_with_role("docrestsenior@example.com", "Mentor")
        for access in (owner_access, senior_access):
            response = self.client.get(
                reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(access)
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            response = self.client.get(
                reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(access)
            )
            self.assertEqual([r["other_id"] for r in response.data], [document["id"]])


class MultiTenancyIsolationTests(RoleLoginMixin, APITestCase):
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
        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(b_head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        # Not in Org B's search results.
        response = self.client.get(reverse("knowledge-search") + "?q=battery+chemistry", **self._auth(b_head_access))
        self.assertNotIn(article["id"], {r["id"] for r in response.data["results"]})
        self.assertEqual(response.data["counts"]["article"], 0)

        # Org A's own head still sees it fine, unaffected by any of the above.
        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(a_head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_relation_creation_across_organizations_is_rejected(self):
        """The one place a cross-org link could otherwise sneak in via a
        guessed target UUID, since source and target resolve independently."""
        _, a_head_access = self._login_with_role("a-relhead@example.com", "Subteam Head", self.org_a)
        a_project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Org A Project"},
            format="json",
            **self._auth(a_head_access),
        ).data

        _, b_head_access = self._login_with_role("b-relhead@example.com", "Subteam Head", self.org_b)
        b_project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Org B Project"},
            format="json",
            **self._auth(b_head_access),
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
            u["id"] for u in self.client.get(reverse("rbac-users"), **self._auth(b_admin_access)).data["results"]
        }
        a_admin_id = str(User.objects.get(email="a-rbacadmin@example.com").id)
        self.assertNotIn(a_admin_id, b_user_ids)

        # Org A's own admin still manages their own role/users fine.
        response = self.client.get(reverse("rbac-role-detail", args=[a_member_role.id]), **self._auth(a_admin_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class BookmarkListTests(KnowledgeTestCase):
    """The bookmark list used to load and check every bookmark's target one by
    one before paginating. Visibility is now checked per content type - with
    the same rules as before."""

    def _bookmark(self, access, content_type, object_id):
        response = self.client.post(
            reverse("knowledge-bookmark-list-create"),
            {"content_type": content_type, "object_id": object_id},
            format="json",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def _list(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(reverse("knowledge-bookmark-list-create"))
        self.client.credentials()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return len(ctx.captured_queries), response.data["results"]

    def _project(self, access, name, **extra):
        return self.client.post(
            reverse("knowledge-project-list-create"), {"name": name, **extra}, format="json", **self._auth(access)
        ).data

    def test_query_count_flat_and_visibility_rules_kept(self):
        # A Member: no project.update override, so RESTRICTED projects they don't
        # own are hidden from them (a Subteam Head's override would see them).
        _, member_access = self._login_with_role("bmmember@example.com", "Member")
        _, admin_access = self._login_with_role("bmadmin@example.com", "Organization Admin")

        for i in range(2):
            self._bookmark(member_access, "project", self._project(admin_access, f"P{i}")["id"])
        small, _ = self._list(member_access)
        for i in range(2, 6):
            self._bookmark(member_access, "project", self._project(admin_access, f"P{i}")["id"])
        large, results = self._list(member_access)
        self.assertEqual(large, small, f"{small} queries for 2 bookmarks, {large} for 6")
        self.assertEqual(len(results), 6)
        self.assertTrue(all(result["title"] for result in results))

        # Own unpublished draft: still listed (a published-only filter would drop it).
        draft = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "My draft", "content": "x"},
            format="json",
            **self._auth(member_access),
        ).data
        self._bookmark(member_access, "article", draft["id"])
        # Someone else's item that later turns RESTRICTED: dropped.
        secret = self._project(admin_access, "Secret")
        self._bookmark(member_access, "project", secret["id"])
        self.client.patch(
            reverse("knowledge-project-detail", args=[secret["id"]]),
            {"visibility": "RESTRICTED"},
            format="json",
            **self._auth(admin_access),
        )
        _, results = self._list(member_access)
        listed = {result["object_id"] for result in results}
        self.assertIn(draft["id"], listed)
        self.assertNotIn(secret["id"], listed)


class ContributionScoreCacheTests(KnowledgeTestCase):
    """Scores are cached per org/window (they were recomputed from the whole
    audit log on every leaderboard and profile view) - but a new scored action
    must show up immediately, not after the TTL."""

    def test_cached_until_the_audit_log_changes(self):
        user, head_access = self._login_with_role("scorecache@example.com", "Subteam Head")
        organization = user.organization
        before = services.compute_contribution_scores_for(organization).get(user.id, 0)
        with self.assertNumQueries(0):  # served from cache (the version lookup is cache too)
            services.compute_contribution_scores_for(organization)

        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Scored", "content": "x"},
            format="json",
            **self._auth(head_access),
        ).data
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        after = services.compute_contribution_scores_for(organization).get(user.id, 0)
        self.assertGreater(after, before)


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
        other_user = User.objects.create_user(
            email="otherorgleader@example.com", password="password123", organization=other_org
        )
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
        entry_by_id = {entry["user"]["id"]: entry["score"] for entry in response.data}

        self.assertNotIn(str(other_user.id), entry_by_id)
        self.assertEqual(entry_by_id[str(prolific.id)], 3)
        self.assertEqual(entry_by_id[str(quiet.id)], 1)
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
            entry_by_id = {entry["user"]["id"]: entry["score"] for entry in response.data}
            # A contribution made moments ago always falls inside every window,
            # including "month"/"year" - it's the exclusion of older activity
            # (not covered here) that those windows exist for.
            self.assertEqual(entry_by_id[str(contributor.id)], 1)

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

        senior, senior_access = self._login_with_role("scorearticleeditor@example.com", "Mentor")
        self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"content": "Revised body"},
            format="json",
            **self._auth(senior_access),
        )

        response = self.client.get(
            reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(author_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        contributor_ids = {c["id"] for c in response.data["contributors"]}
        self.assertEqual(contributor_ids, {str(author.id), str(senior.id)})

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

        response = self.client.get(reverse("audit-user-activity", args=[target.id]), **self._auth(other_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["action"], "question.create")

        other_org = create_test_organization(name="Other Org For Activity")
        outsider = User.objects.create_user(
            email="activityoutsider@example.com", password="password123", organization=other_org
        )
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
        response = self.client.get(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access)
        )
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
        self.assertEqual(response.data["granted_user"]["id"], str(grantee.id))

        response = self.client.get(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual({g["user"]["id"] for g in response.data["restricted_to"]}, {str(grantee.id)})
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(other_access))
        self.assertIn(project["id"], {p["id"] for p in response.data["results"]})

        # Revoke it - back to inaccessible.
        response = self.client.delete(
            reverse("knowledge-access-grant-detail", args=[grant_id]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        response = self.client.get(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(other_access)
        )
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
        response = self.client.get(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(admin_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.get(reverse("knowledge-project-list-create"), **self._auth(admin_access))
        self.assertIn(project["id"], {p["id"] for p in response.data["results"]})
        self.assertEqual(RestrictedAccessGrant.objects.count(), 0)  # no grant needed


class BookmarkTests(KnowledgeTestCase):
    def test_bookmark_create_list_and_delete(self):
        _, head_access = self._login_with_role("bookmarkhead@example.com", "Subteam Head")
        project = self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Bookmarked Airframe"},
            format="json",
            **self._auth(head_access),
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

        response = self.client.get(
            reverse("knowledge-project-detail", args=[project["id"]]), **self._auth(member_access)
        )
        self.assertEqual(response.data["bookmark_id"], bookmark_id)

        response = self.client.get(reverse("knowledge-bookmark-list-create"), **self._auth(member_access))
        self.assertEqual([b["id"] for b in response.data["results"]], [bookmark_id])

        response = self.client.delete(
            reverse("knowledge-bookmark-detail", args=[bookmark_id]), **self._auth(member_access)
        )
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
            reverse("knowledge-project-list-create"),
            {"name": "Later Restricted Airframe"},
            format="json",
            **self._auth(head_access),
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


class CrossOrgAccessGrantAndBookmarkTests(RoleLoginMixin, APITestCase):
    """Same two-organization shape as MultiTenancyIsolationTests above (not
    a subclass of it - that would re-run its tests a second time under this
    class name) for the two new cross-org attack surfaces this feature set
    adds: a guessed-id grant, and a guessed-id bookmark."""

    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Org A Grants")
        cls.org_b = create_test_organization(name="Org B Grants")

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
            reverse("knowledge-project-list-create"),
            {"name": "Org A Project To Guess"},
            format="json",
            **self._auth(a_head_access),
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


# The workshop inventory sheet's own layout, verbatim headers - including its
# duplicate "Scissors"/"Wrench" rows (same item, same place) and en-dashes.
MECHANICAL_SHEET_CSV = (
    "Category,Item,Grid Location,Quantity,Unit,Condition,Status,Min. Qty Desired,Notes,Last Updated,Updated By\n"
    "Power Tools,Mini Drill Kit,Total Mini Drill Kit,1,set,New,In Stock,,Main mini drill kit,2026-09-20,Initial Import\n"
    'Hand Tools,Scissors,Fuselage Box -> Hand Tools,1,each,Good,In Stock,,"Loose, from hand tools shelf",2026-09-20,Initial Import\n'
    'Hand Tools,Scissors,Fuselage Box -> Hand Tools,2,each,Good,In Stock,,"Loose, from hand tools shelf",2026-09-20,Initial Import\n'
    "Hand Tools,Screwdriver – Phillips,Fuselage Box -> Hand Tools,1,each,Good,In Stock,None,,2026-09-20,Initial Import\n"
    "Hand Tools,Cutter / Utility Knife,Fuselage Box -> Hand Tools,2,each,Good,Low Stock,,,2026-09-20,Initial Import\n"
    "Wood & Sheet Goods,Balsa Sheet 2mm,Wood Rack,0,sheet,,Missing / Need to Order,5,,2026-09-20,Initial Import\n"
    ",,,,,,,,,,\n"
)


class RelinkRemovesOldAutoRelationTests(KnowledgeTestCase):
    """Changing a failure's component/project (or a test's project) used to only
    add the new auto-relation, so the old item kept listing it."""

    def _post(self, access, name, payload):
        response = self.client.post(reverse(name), payload, format="json", **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data

    def _linked(self, item_id, other_id):
        return KnowledgeRelation.objects.filter(
            Q(source_object_id=item_id, target_object_id=other_id)
            | Q(source_object_id=other_id, target_object_id=item_id)
        ).exists()

    def test_moving_a_failure_drops_the_old_component_and_project_links(self):
        _, head_access = self._login_with_role("relinkhead@example.com", "Subteam Head")
        motor_a = self._post(head_access, "knowledge-component-list-create", {"name": "Motor A"})
        motor_b = self._post(head_access, "knowledge-component-list-create", {"name": "Motor B"})
        falcon = self._post(head_access, "knowledge-project-list-create", {"name": "Falcon"})
        failure = self._post(
            head_access,
            "knowledge-failure-list-create",
            {"title": "Overheat", "component_id": motor_a["id"], "project_id": falcon["id"]},
        )
        self.assertTrue(self._linked(failure["id"], motor_a["id"]))
        self.assertTrue(self._linked(failure["id"], falcon["id"]))

        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure["id"]]),
            {"component_id": motor_b["id"], "project_id": None},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(self._linked(failure["id"], motor_a["id"]))
        self.assertTrue(self._linked(failure["id"], motor_b["id"]))
        self.assertFalse(self._linked(failure["id"], falcon["id"]))

    def test_moving_a_test_drops_the_old_project_link(self):
        _, head_access = self._login_with_role("relinktesthead@example.com", "Subteam Head")
        falcon = self._post(head_access, "knowledge-project-list-create", {"name": "Falcon"})
        hawk = self._post(head_access, "knowledge-project-list-create", {"name": "Hawk"})
        test = self._post(
            head_access, "knowledge-test-list-create", {"title": "Thrust run", "project_id": falcon["id"]}
        )
        self.assertTrue(self._linked(test["id"], falcon["id"]))

        response = self.client.patch(
            reverse("knowledge-test-detail", args=[test["id"]]),
            {"project_id": hawk["id"]},
            format="json",
            **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(self._linked(test["id"], falcon["id"]))
        self.assertTrue(self._linked(test["id"], hawk["id"]))


class ComponentInventoryTests(KnowledgeTestCase):
    """Workshop inventory on components - the fields, the automatic stock
    status, and syncing with the inventory spreadsheet through CSV."""

    def _import(self, access, content, *, commit, encoding="utf-8", **options):
        upload = SimpleUploadedFile("inventory.csv", content.encode(encoding), content_type="text/csv")
        return self.client.post(
            reverse("knowledge-component-import"),
            {"file": upload, "commit": "true" if commit else "false", **options},
            format="multipart",
            **self._auth(access),
        )

    def _create(self, access, **payload):
        response = self.client.post(
            reverse("knowledge-component-list-create"), payload, format="json", **self._auth(access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return Component.objects.get(pk=response.data["id"])

    def _patch(self, access, component, **payload):
        response = self.client.patch(
            reverse("knowledge-component-detail", args=[component.pk]), payload, format="json", **self._auth(access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        component.refresh_from_db()
        return response

    def _export(self, access, query=""):
        response = self.client.get(reverse("knowledge-component-export") + query, **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.getvalue().decode("utf-8-sig")

    # --- fields and stock status ------------------------------------------------

    def test_stock_status_is_derived_from_quantity_unless_set_by_hand(self):
        user, mentor_access = self._login_with_role("stockderive@example.com", "Mentor")
        drill = self._create(mentor_access, name="Drill", quantity_available=3, min_quantity=2)
        self.assertEqual(drill.stock_status, Component.StockStatus.IN_STOCK)
        self.assertEqual(drill.updated_by, user)

        self._patch(mentor_access, drill, quantity_available=1)
        self.assertEqual(drill.stock_status, Component.StockStatus.LOW_STOCK)  # below the minimum
        self._patch(mentor_access, drill, quantity_available=0)
        self.assertEqual(drill.stock_status, Component.StockStatus.MISSING)

        self._patch(mentor_access, drill, stock_status="ON_ORDER")
        self._patch(mentor_access, drill, quantity_available=5)
        self.assertEqual(drill.stock_status, Component.StockStatus.ON_ORDER)  # a person's call - kept

        self._patch(mentor_access, drill, stock_status="")  # back to automatic
        self.assertEqual(drill.stock_status, Component.StockStatus.IN_STOCK)

    def test_manual_low_stock_without_a_minimum_survives_quantity_changes(self):
        _, mentor_access = self._login_with_role("stocklow@example.com", "Mentor")
        tape = self._create(mentor_access, name="Tape", quantity_available=3, stock_status="LOW_STOCK")
        self._patch(mentor_access, tape, quantity_available=2)
        self.assertEqual(tape.stock_status, Component.StockStatus.LOW_STOCK)

    def test_location_is_set_by_name_created_on_the_fly_and_cleared_with_blank(self):
        _, mentor_access = self._login_with_role("locname@example.com", "Mentor")
        saw = self._create(mentor_access, name="Hand Saw", location_name="Fuselage Box -> Hand Tools")
        hammer = self._create(mentor_access, name="Hammer", location_name="fuselage box -> hand tools")
        self.assertEqual(saw.location_id, hammer.location_id)  # case-insensitive - one location
        self.assertEqual(StorageLocation.objects.filter(organization=self.organization).count(), 1)

        response = self._patch(mentor_access, saw, location_name="")
        self.assertIsNone(saw.location)
        self.assertIsNone(response.data["location"])

    def test_component_category_from_another_organization_is_rejected(self):
        _, mentor_access = self._login_with_role("catcross@example.com", "Mentor")
        other_org = create_test_organization(name="Other Workshop")
        foreign = ComponentCategory.objects.create(organization=other_org, name="Power Tools", slug="power-tools")
        response = self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Drill", "category_id": str(foreign.pk)},
            format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_filters_by_inventory_type_location_and_stock_statuses(self):
        _, mentor_access = self._login_with_role("invfilter@example.com", "Mentor")
        self._create(
            mentor_access, name="Drill", inventory_type="MECHANICAL", quantity_available=1, location_name="Box A"
        )
        self._create(mentor_access, name="Balsa", inventory_type="MECHANICAL", quantity_available=0)
        self._create(
            mentor_access, name="Motor", inventory_type="ELECTRICAL", quantity_available=2, stock_status="ON_ORDER"
        )
        url = reverse("knowledge-component-list-create")

        def names(query):
            response = self.client.get(url + query, **self._auth(mentor_access))
            return sorted(c["name"] for c in response.data["results"])

        self.assertEqual(names("?inventory_type=MECHANICAL"), ["Balsa", "Drill"])
        self.assertEqual(names("?stock_status=MISSING,ON_ORDER"), ["Balsa", "Motor"])
        location = StorageLocation.objects.get(organization=self.organization, name="Box A")
        self.assertEqual(names(f"?location={location.pk}"), ["Drill"])
        response = self.client.get(url + "?location=not-a-uuid", **self._auth(mentor_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inventory_summary_counts_by_status_and_category(self):
        _, mentor_access = self._login_with_role("invsummary@example.com", "Mentor")
        response = self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self._create(mentor_access, name="Motor", inventory_type="ELECTRICAL", quantity_available=1)

        response = self.client.get(
            reverse("knowledge-component-inventory-summary") + "?inventory_type=MECHANICAL", **self._auth(mentor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["total"], 6)
        self.assertEqual(response.data["by_status"]["IN_STOCK"], 4)
        self.assertEqual(response.data["by_status"]["LOW_STOCK"], 1)
        self.assertEqual(response.data["by_status"]["MISSING"], 1)
        hand_tools = next(row for row in response.data["by_category"] if row["category"] == "Hand Tools")
        self.assertEqual(hand_tools["total"], 4)
        self.assertEqual(hand_tools["by_status"]["LOW_STOCK"], 1)

    # --- importing the sheet ------------------------------------------------------

    def test_import_rejects_out_of_range_cells_as_row_errors(self):
        # Each of these used to reach the database and 500 mid-commit (DataError /
        # OverflowError), or - for the javascript: link - be stored as-is.
        _, mentor_access = self._login_with_role("csvlimits@example.com", "Mentor")
        csv_content = (
            "Item,Quantity,Link\n"
            f"{'x' * 201},1,\n"
            "Infinite,inf,\n"
            "Huge,99999999999,\n"
            "Scripted,1,javascript:alert(1)\n"
            "Fine,2,https://example.com/part\n"
        )
        response = self._import(mentor_access, csv_content, commit=False)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        actions = [row["action"] for row in response.data["rows"]]
        self.assertEqual(actions, ["error", "error", "error", "error", "create"])
        messages = [row.get("message", "") for row in response.data["rows"][:4]]
        self.assertIn("too long", messages[0])
        self.assertIn("whole number", messages[1])
        self.assertIn("at most", messages[2])
        self.assertIn("http", messages[3])

        response = self._import(mentor_access, csv_content, commit=True)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["applied"]["created"], 1)
        self.assertEqual(list(Component.objects.values_list("name", flat=True)), ["Fine"])

    def test_import_commit_is_all_or_nothing(self):
        # A row failing part-way through the commit must not leave earlier rows saved
        # (re-running the import would otherwise duplicate them).
        _, mentor_access = self._login_with_role("csvatomic@example.com", "Mentor")
        real_create = services.create_component
        calls = []

        def create_then_fail(**kwargs):
            calls.append(kwargs["name"])
            if len(calls) == 2:
                raise RuntimeError("simulated failure on the second row")
            return real_create(**kwargs)

        with mock.patch.object(services, "create_component", side_effect=create_then_fail):
            with self.assertRaises(RuntimeError):
                self._import(mentor_access, "Item,Quantity\nFirst,1\nSecond,1\n", commit=True)
        self.assertEqual(calls, ["First", "Second"])
        self.assertFalse(Component.objects.filter(name="First").exists())

    def test_sheet_tab_imports_as_is_with_its_own_headers_and_labels(self):
        _, mentor_access = self._login_with_role("sheetimport@example.com", "Mentor")
        response = self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["summary"]["error"], 0, response.data["rows"])
        self.assertEqual(response.data["summary"]["duplicate_groups"], 1)
        self.assertEqual(response.data["applied"]["created"], 6)  # both Scissors rows kept, blank row skipped

        balsa = Component.objects.get(organization=self.organization, name="Balsa Sheet 2mm")
        self.assertEqual(balsa.inventory_type, Component.InventoryType.MECHANICAL)
        self.assertEqual(balsa.stock_status, Component.StockStatus.MISSING)
        self.assertEqual(balsa.min_quantity, 5)
        self.assertEqual(balsa.unit, "sheet")
        self.assertEqual(balsa.location.name, "Wood Rack")
        self.assertEqual(balsa.category.name, "Wood & Sheet Goods")
        self.assertEqual(balsa.status, "")  # no engineering status for a workshop material

        phillips = Component.objects.get(organization=self.organization, name="Screwdriver – Phillips")
        self.assertIsNone(phillips.min_quantity)  # "None" cell
        self.assertEqual(phillips.condition, Component.Condition.GOOD)
        cutter = Component.objects.get(organization=self.organization, name="Cutter / Utility Knife")
        self.assertEqual(cutter.stock_status, Component.StockStatus.LOW_STOCK)
        self.assertEqual(cutter.inventory_notes, "")

        scissors = Component.objects.filter(organization=self.organization, name="Scissors").order_by(
            "quantity_available"
        )
        self.assertEqual([c.quantity_available for c in scissors], [1, 2])

        # The sheet's categories never reach the knowledge category list.
        self.assertFalse(Category.objects.filter(organization=self.organization, name="Hand Tools").exists())

    def test_reimporting_the_same_sheet_changes_nothing_even_with_duplicate_rows(self):
        _, mentor_access = self._login_with_role("sheetreimport@example.com", "Mentor")
        self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")

        response = self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")

        self.assertEqual(response.data["applied"], {"created": 0, "updated": 0, "skipped": 6}, response.data["rows"])
        self.assertEqual(Component.objects.filter(organization=self.organization, name="Scissors").count(), 2)

    def test_duplicate_rows_can_be_merged_with_quantities_added(self):
        _, mentor_access = self._login_with_role("sheetmerge@example.com", "Mentor")
        response = self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, duplicates="merge")

        self.assertEqual(response.data["summary"]["merged"], 1)
        rows = {row["row"]: row for row in response.data["rows"]}
        self.assertEqual(rows[4]["action"], "merged")
        self.assertEqual(rows[4]["merged_into"], 3)
        self.assertTrue(rows[3]["warnings"])
        scissors = Component.objects.get(organization=self.organization, name="Scissors")
        self.assertEqual(scissors.quantity_available, 3)
        self.assertEqual(scissors.inventory_notes, "Loose, from hand tools shelf")

    def test_first_import_attaches_to_existing_component_without_a_location(self):
        _, mentor_access = self._login_with_role("sheetattach@example.com", "Mentor")
        drill = self._create(mentor_access, name="Mini Drill Kit", manufacturer="Total")

        self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True)

        drill.refresh_from_db()
        self.assertEqual(drill.location.name, "Total Mini Drill Kit")
        self.assertEqual(drill.manufacturer, "Total")  # not in the sheet - untouched
        self.assertEqual(Component.objects.filter(organization=self.organization, name="Mini Drill Kit").count(), 1)

    def test_ambiguous_name_match_asks_for_athar_id(self):
        _, mentor_access = self._login_with_role("sheetambig@example.com", "Mentor")
        self._create(mentor_access, name="Wrench", location_name="Box A")
        self._create(mentor_access, name="Wrench", location_name="Box B")

        response = self._import(mentor_access, "Item,Quantity\nWrench,3\n", commit=False)

        row = response.data["rows"][0]
        self.assertEqual(row["action"], "error")
        self.assertIn("Athar ID", row["message"])

    def test_status_cell_accepts_both_stock_and_engineering_values(self):
        _, mentor_access = self._login_with_role("sheetstatus@example.com", "Mentor")
        csv_content = "Item,Status\nOld Heat Gun,Retired / Broken\nESC 40A,Certified\nThing,Sparkly\n"
        response = self._import(mentor_access, csv_content, commit=True)

        errors = [row for row in response.data["rows"] if row["action"] == "error"]
        self.assertEqual([row["row"] for row in errors], [4])
        self.assertIn("Sparkly", errors[0]["message"])
        heat_gun = Component.objects.get(organization=self.organization, name="Old Heat Gun")
        self.assertEqual(heat_gun.stock_status, Component.StockStatus.RETIRED)
        esc = Component.objects.get(organization=self.organization, name="ESC 40A")
        self.assertEqual(esc.status, Component.Status.CERTIFIED)

    def test_excel_semicolon_csv_in_windows_1252_imports(self):
        _, mentor_access = self._login_with_role("sheetexcel@example.com", "Mentor")
        csv_content = "Item;Grid Location;Quantity\nScrewdriver – Slotted;Fuselage Box;1\n"
        response = self._import(mentor_access, csv_content, commit=True, encoding="cp1252")
        self.assertEqual(response.data["applied"]["created"], 1, response.data)
        self.assertTrue(Component.objects.filter(name="Screwdriver – Slotted").exists())

    def test_file_without_an_item_column_is_rejected(self):
        _, mentor_access = self._login_with_role("sheetnohead@example.com", "Mentor")
        response = self._import(mentor_access, "Foo,Bar\n1,2\n", commit=False)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_import_options_are_rejected(self):
        _, mentor_access = self._login_with_role("sheetopts@example.com", "Mentor")
        response = self._import(mentor_access, "Item\nX\n", commit=False, duplicates="sometimes")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self._import(mentor_access, "Item\nX\n", commit=False, inventory_type="PLUMBING")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- exporting and the round trip ------------------------------------------------

    def test_export_uses_the_sheet_layout_and_labels(self):
        _, mentor_access = self._login_with_role("sheetexport@example.com", "Mentor")
        self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")

        lines = self._export(mentor_access, "?inventory_type=MECHANICAL&ordering=name").splitlines()

        self.assertEqual(lines[0].split(","), services.INVENTORY_CSV_COLUMNS)
        balsa = next(line for line in lines if "Balsa Sheet 2mm" in line)
        self.assertIn("Missing / Need to Order", balsa)
        self.assertIn(",Mechanical,", balsa)
        self.assertEqual(balsa.split(",")[0], str(Component.objects.get(name="Balsa Sheet 2mm").pk))

    def test_export_then_reimport_is_a_no_op(self):
        _, mentor_access = self._login_with_role("sheetroundtrip@example.com", "Mentor")
        self._import(mentor_access, MECHANICAL_SHEET_CSV, commit=True, inventory_type="MECHANICAL")
        self._create(
            mentor_access,
            name="Pixhawk",
            inventory_type="ELECTRICAL",
            quantity_available=2,
            tag_names=["Avionics"],
            specifications=[{"label": "IMU", "value": "Triple"}],
            summary="Line one\nLine two",
            status="CERTIFIED",
        )

        response = self._import(mentor_access, self._export(mentor_access), commit=False)

        self.assertEqual(response.data["summary"]["unchanged"], 7, response.data["rows"])
        self.assertEqual(response.data["summary"]["create"] + response.data["summary"]["update"], 0)

    def test_athar_id_matches_exactly_even_after_a_rename_in_the_sheet(self):
        _, mentor_access = self._login_with_role("sheetid@example.com", "Mentor")
        drill = self._create(mentor_access, name="Drill", quantity_available=1)

        csv_content = f"Athar ID,Item,Quantity\n{drill.pk},Cordless Drill (Old),2\n"
        response = self._import(mentor_access, csv_content, commit=True)

        self.assertEqual(response.data["applied"]["updated"], 1, response.data)
        drill.refresh_from_db()
        self.assertEqual(drill.name, "Cordless Drill (Old)")
        self.assertEqual(drill.quantity_available, 2)

    def test_unknown_or_repeated_athar_id_is_an_error(self):
        _, mentor_access = self._login_with_role("sheetbadid@example.com", "Mentor")
        drill = self._create(mentor_access, name="Drill")
        csv_content = (
            "Athar ID,Item,Quantity\n"
            "00000000-0000-0000-0000-000000000000,Ghost,1\n"
            f"{drill.pk},Drill,2\n"
            f"{drill.pk},Drill,3\n"
        )
        response = self._import(mentor_access, csv_content, commit=False)
        actions = [row["action"] for row in response.data["rows"]]
        self.assertEqual(actions, ["error", "update", "error"])

    def test_website_edit_after_the_sheets_last_updated_warns_before_overwriting(self):
        _, mentor_access = self._login_with_role("sheetconflict@example.com", "Mentor")
        drill = self._create(mentor_access, name="Drill", quantity_available=1)

        csv_content = f"Athar ID,Item,Quantity,Last Updated\n{drill.pk},Drill,4,2020-01-01\n"
        response = self._import(mentor_access, csv_content, commit=False)

        row = response.data["rows"][0]
        self.assertEqual(row["action"], "update")
        self.assertTrue(any("overwrites" in warning for warning in row["warnings"]))

    # --- categories and locations ---------------------------------------------------

    def test_component_categories_and_locations_are_admin_managed_but_readable_by_members(self):
        _, member_access = self._login_with_role("invlistmember@example.com", "Member")
        _, admin_access = self._login_with_role("invlistadmin@example.com", "Organization Admin")
        for list_name in ("knowledge-component-category-list", "knowledge-storage-location-list"):
            url = reverse(list_name)
            self.assertEqual(self.client.get(url, **self._auth(member_access)).status_code, status.HTTP_200_OK)
            response = self.client.post(url, {"name": "Shelf 1"}, format="json", **self._auth(member_access))
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            response = self.client.post(url, {"name": "Shelf 1"}, format="json", **self._auth(admin_access))
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            response = self.client.post(url, {"name": "shelf 1"}, format="json", **self._auth(admin_access))
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)  # duplicate, any case

    def test_renaming_a_location_onto_another_merges_them(self):
        _, mentor_access = self._login_with_role("locmergementor@example.com", "Mentor")
        _, admin_access = self._login_with_role("locmergeadmin@example.com", "Organization Admin")
        typo = self._create(mentor_access, name="Hammer", location_name="Fuselage box").location
        right = self._create(mentor_access, name="Saw", location_name="Fuselage Box -> Hand Tools").location

        response = self.client.patch(
            reverse("knowledge-storage-location-detail", args=[typo.pk]),
            {"name": "fuselage box -> hand tools"},
            format="json",
            **self._auth(admin_access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], str(right.pk))
        self.assertEqual(response.data["component_count"], 2)
        self.assertFalse(StorageLocation.objects.filter(pk=typo.pk).exists())


class CreationFlowTests(KnowledgeTestCase):
    """Creation-form extras (services.create_with_links): project link,
    visibility inheritance, create-time relations, co-authors, and editing
    a relation's type."""

    def setUp(self):
        self.head, self.head_access = self._login_with_role("cf-head@example.com", "Subteam Head")
        self.member, self.member_access = self._login_with_role("cf-member@example.com", "Member")

    def _project(self, visibility="PUBLIC"):
        return self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": f"Project {visibility}", "visibility": visibility},
            format="json",
            **self._auth(self.head_access),
        ).data

    def test_article_inherits_project_visibility_and_grants_and_is_linked(self):
        project = self._project("RESTRICTED")
        grantee = User.objects.create_user(email="cf-grantee@example.com", password="x", organization=self.organization)
        services.add_restricted_access(
            actor=self.head, content_type="project", object_id=project["id"], user_id=grantee.id
        )

        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Child", "content": "Body", "project_id": project["id"]},
            format="json",
            **self._auth(self.head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["visibility"], "RESTRICTED")
        article = Article.objects.get(pk=response.data["id"])
        self.assertTrue(RestrictedAccessGrant.objects.filter(object_id=article.pk, granted_user=grantee).exists())
        relation = KnowledgeRelation.objects.get(target_object_id=article.pk)
        self.assertEqual(str(relation.source_object_id), project["id"])
        self.assertEqual(relation.relation_type, "DOCUMENTED_BY")

    def test_explicit_visibility_overrides_project(self):
        project = self._project("RESTRICTED")
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Public child", "content": "Body", "project_id": project["id"], "visibility": "PUBLIC"},
            format="json",
            **self._auth(self.head_access),
        )
        self.assertEqual(response.data["visibility"], "PUBLIC")
        self.assertFalse(RestrictedAccessGrant.objects.filter(object_id=response.data["id"]).exists())

    def test_failure_inherits_from_project_fk_and_creates_component_and_project_relations(self):
        project = self._project("RESTRICTED")
        component = self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Pixhawk 6X"},
            format="json",
            **self._auth(self.head_access),
        ).data
        response = self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "Crash", "project_id": project["id"], "component_id": component["id"]},
            format="json",
            **self._auth(self.head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["visibility"], "RESTRICTED")
        failure_id = response.data["id"]

        failure_relations = self.client.get(
            reverse("knowledge-failure-relations", args=[failure_id]), **self._auth(self.head_access)
        ).data
        self.assertEqual(
            {(r["other_type"], r["other_id"], r["relation_label"]) for r in failure_relations},
            {
                ("project", project["id"], "OCCURRED_IN"),
                ("component", component["id"], "INVOLVES"),
            },
        )

    def test_invisible_project_is_rejected_and_nothing_is_created(self):
        project = self._project("RESTRICTED")
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Sneaky", "content": "Body", "project_id": project["id"]},
            format="json",
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Article.objects.filter(title="Sneaky").exists())

    def test_create_time_relations_are_atomic(self):
        target = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Target", "content": "Body"},
            format="json",
            **self._auth(self.member_access),
        ).data
        response = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Q", "body": "?", "relations": [{"target_type": "article", "target_id": target["id"]}]},
            format="json",
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(KnowledgeRelation.objects.filter(source_object_id=response.data["id"]).count(), 1)

        # An invalid verb rolls back the whole create, not just the relation.
        response = self.client.post(
            reverse("knowledge-question-list-create"),
            {
                "title": "Rolled back",
                "body": "?",
                "relations": [{"target_type": "article", "target_id": target["id"], "relation_type": "NOPE"}],
            },
            format="json",
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Question.objects.filter(title="Rolled back").exists())

    def test_co_author_can_view_restricted_draft_and_edit_but_not_change_co_authors(self):
        co_author, co_access = self._login_with_role("cf-co@example.com", "Member")
        outsider, _ = self._login_with_role("cf-out@example.com", "Member")
        article = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "Joint", "content": "Body", "visibility": "RESTRICTED", "co_author_ids": [str(co_author.id)]},
            format="json",
            **self._auth(self.member_access),
        ).data
        self.assertEqual([u["id"] for u in article["co_authors"]], [str(co_author.id)])

        response = self.client.get(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(co_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"title": "Joint v2"},
            format="json",
            **self._auth(co_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.patch(
            reverse("knowledge-article-detail", args=[article["id"]]),
            {"co_author_ids": [str(co_author.id), str(outsider.id)]},
            format="json",
            **self._auth(co_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Listed among the co-author's own drafts.
        response = self.client.get(
            reverse("knowledge-article-list-create"), {"status": "DRAFT"}, **self._auth(co_access)
        )
        self.assertIn(article["id"], {a["id"] for a in response.data["results"]})

    def test_cross_org_co_author_is_rejected(self):
        other_org = create_test_organization(name="Other")
        stranger = User.objects.create_user(email="cf-stranger@example.com", password="x", organization=other_org)
        response = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Q", "body": "?", "co_author_ids": [str(stranger.id)]},
            format="json",
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Question.objects.filter(title="Q").exists())

    def test_update_relation_type_from_either_side(self):
        project = self._project()
        component = self.client.post(
            reverse("knowledge-component-list-create"),
            {"name": "Servo"},
            format="json",
            **self._auth(self.head_access),
        ).data
        relation = services.create_relation(
            actor=self.head,
            source_type="component",
            source_id=component["id"],
            target_type="project",
            target_id=project["id"],
        )
        response = self.client.patch(
            reverse("knowledge-relation-detail", args=[relation.id]),
            {"from_type": "component", "from_id": component["id"], "relation_type": "USED_IN"},
            format="json",
            **self._auth(self.head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["relation_label"], "USED_IN")
        relation.refresh_from_db()
        # Stored canonically: Project--USES-->Component.
        self.assertEqual(relation.relation_type, "USES")
        self.assertEqual(str(relation.source_object_id), project["id"])

        response = self.client.patch(
            reverse("knowledge-relation-detail", args=[relation.id]),
            {"from_type": "component", "from_id": component["id"], "relation_type": "USED_IN"},
            format="json",
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_co_authors_share_contribution_credit(self):
        co_author, _ = self._login_with_role("cf-score-co@example.com", "Member")
        self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Shared Q", "body": "?", "co_author_ids": [str(co_author.id)]},
            format="json",
            **self._auth(self.member_access),
        )
        scores = services.compute_contribution_scores_for(self.organization)
        # question.create = +1, credited to both the author and the co-author.
        self.assertEqual(scores.get(self.member.id), 1)
        self.assertEqual(scores.get(co_author.id), 1)

        # Listed among the co-author's contributions too.
        response = self.client.get(
            reverse("knowledge-user-contributions", args=[co_author.id]),
            {"type": "question"},
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)

        # sop.create = +6, credited to both the creator and the co-author.
        res = self.client.post(
            reverse("knowledge-sop-list-create"),
            {"title": "Shared SOP", "scope": "Safe operation", "co_author_ids": [str(co_author.id)]},
            format="json",
            **self._auth(self.head_access),
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        scores = services.compute_contribution_scores_for(self.organization)
        self.assertEqual(scores.get(self.head.id), 6)
        self.assertEqual(scores.get(co_author.id), 1 + 6)

        response = self.client.get(
            reverse("knowledge-user-contributions", args=[co_author.id]),
            {"type": "sop"},
            **self._auth(self.member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)


class WriteSerializerScopingTests(RoleLoginMixin, APITestCase):
    """Foreign-key ids on every write serializer (project_id, component_id,
    category_id, file_id, co_author_ids) resolve only within the caller's
    own organization - and, for projects/components, only to rows the caller
    can see - on update as well as create (see serializers.OrgScopedPrimaryKeyRelatedField)."""

    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Scope Org A")
        cls.org_b = create_test_organization(name="Scope Org B")

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def setUp(self):
        self.a_head, self.a_access = self._login_with_role("scope-a@example.com", "Subteam Head", self.org_a)
        self.b_head, self.b_access = self._login_with_role("scope-b@example.com", "Subteam Head", self.org_b)
        self.a_project = Project.objects.create(organization=self.org_a, name="A project", created_by=self.a_head)
        self.a_component = Component.objects.create(organization=self.org_a, name="A servo", created_by=self.a_head)
        self.a_category = Category.objects.create(organization=self.org_a, name="A cat", slug="a-cat")

    def test_failure_update_rejects_another_orgs_project(self):
        failure = self.client.post(
            reverse("knowledge-failure-list-create"), {"title": "B crash"}, format="json", **self._auth(self.b_access)
        ).data
        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure["id"]]),
            {"project_id": str(self.a_project.id)},
            format="json",
            **self._auth(self.b_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIsNone(Failure.objects.get(pk=failure["id"]).project_id)

    def test_test_update_rejects_another_orgs_project(self):
        test = self.client.post(
            reverse("knowledge-test-list-create"), {"title": "B test"}, format="json", **self._auth(self.b_access)
        ).data
        response = self.client.patch(
            reverse("knowledge-test-detail", args=[test["id"]]),
            {"project_id": str(self.a_project.id)},
            format="json",
            **self._auth(self.b_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIsNone(Test.objects.get(pk=test["id"]).project_id)

    def test_create_rejects_another_orgs_component_and_category(self):
        response = self.client.post(
            reverse("knowledge-failure-list-create"),
            {"title": "B crash", "component_id": str(self.a_component.id)},
            format="json",
            **self._auth(self.b_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": "B article", "content": "x", "category_id": str(self.a_category.id)},
            format="json",
            **self._auth(self.b_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Failure.objects.filter(organization=self.org_b).exists())
        self.assertFalse(Article.objects.filter(organization=self.org_b).exists())

    def test_restricted_project_hidden_unless_already_linked(self):
        restricted = Project.objects.create(
            organization=self.org_a, name="Secret", created_by=self.a_head, visibility="RESTRICTED"
        )
        mentor, mentor_access = self._login_with_role("scope-mentor@example.com", "Mentor", self.org_a)
        failure = Failure.objects.create(organization=self.org_a, title="Linked", created_by=self.a_head)

        # Can't link a RESTRICTED project the mentor can't see...
        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure.id]),
            {"project_id": str(restricted.id)},
            format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # ...but re-submitting a link that's already there is fine.
        failure.project = restricted
        failure.save()
        response = self.client.patch(
            reverse("knowledge-failure-detail", args=[failure.id]),
            {"title": "Linked v2", "project_id": str(restricted.id)},
            format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        failure.refresh_from_db()
        self.assertEqual(failure.title, "Linked v2")
        self.assertEqual(failure.project_id, restricted.id)


class CollectionTests(KnowledgeTestCase):
    """Folders / series over existing content: CRUD + item ordering +
    RESTRICTED visibility scoping + the detail-page context injection."""

    def _sop(self, title, visibility="PUBLIC", created_by=None):
        return Sop.objects.create(
            organization=self.organization, title=title, visibility=visibility, created_by=created_by
        )

    def _create_series(self, access, **overrides):
        payload = {"title": "Wing Sizing Series", "mode": "SERIES", **overrides}
        return self.client.post(reverse("knowledge-collection-list"), payload, format="json", **self._auth(access))

    def _add_item(self, access, collection_id, content_type, object_id, **extra):
        return self.client.post(
            reverse("knowledge-collection-item-add", args=[collection_id]),
            {"content_type": content_type, "object_id": str(object_id), **extra},
            format="json",
            **self._auth(access),
        )

    def test_create_requires_collection_manage_and_lists_scoped(self):
        _, member_access = self._login_with_role("colmember@example.com", "Member")
        response = self._create_series(member_access)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        mentor, mentor_access = self._login_with_role("colcreator@example.com", "Mentor")
        response = self._create_series(mentor_access)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["mode"], "SERIES")
        self.assertEqual(response.data["slug"], "wing-sizing-series")
        self.assertEqual(response.data["created_by"]["id"], str(mentor.pk))

        # A collection is also a first-class search/list result.
        response = self.client.get(
            reverse("knowledge-collection-list"), {"q": "wing sizing"}, **self._auth(mentor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)

    def test_add_reorder_and_item_scoping(self):
        _, mentor_access = self._login_with_role("colcurator@example.com", "Mentor")
        collection_id = self._create_series(mentor_access).data["id"]
        sop_a = self._sop("Airfoil 2D")
        sop_b = self._sop("Wing 3D")

        response = self._add_item(mentor_access, collection_id, "sop", sop_a.pk, phase_title="Phase 1")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        response = self._add_item(mentor_access, collection_id, "sop", sop_b.pk)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        detail = self.client.get(
            reverse("knowledge-collection-detail", args=[collection_id]), **self._auth(mentor_access)
        ).data
        item_a, item_b = (item["id"] for item in detail["items"])

        # Duplicate content in the same collection is a 400 (other collections may repeat it).
        response = self._add_item(mentor_access, collection_id, "sop", sop_a.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        detail = self.client.get(
            reverse("knowledge-collection-detail", args=[collection_id]), **self._auth(mentor_access)
        ).data
        self.assertEqual([item["order"] for item in detail["items"]], [0, 1])
        self.assertEqual([item["content"]["title"] for item in detail["items"]], ["Airfoil 2D", "Wing 3D"])
        self.assertIsNone(detail["items"][1]["phase_title"])

        # Reorder swaps them; a foreign/duplicate id is a 400, not skipped.
        item_ids = [item["id"] for item in detail["items"]]
        response = self.client.post(
            reverse("knowledge-collection-reorder", args=[collection_id]),
            {"item_ids": list(reversed(item_ids))},
            format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["content"]["title"] for item in response.data["items"]], ["Wing 3D", "Airfoil 2D"])
        response = self.client.post(  # same id twice -> a duplicate, not a reorder
            reverse("knowledge-collection-reorder", args=[collection_id]),
            {"item_ids": [item_a, item_a]},
            format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_series_embeds_prev_next_navigation_in_the_sop_detail(self):
        mentor, mentor_access = self._login_with_role("colnav@example.com", "Mentor")
        collection_id = self._create_series(mentor_access).data["id"]
        sop_a = self._sop("Airfoil 2D")
        sop_b = self._sop("Wing 3D", created_by=mentor)
        self._add_item(mentor_access, collection_id, "sop", sop_a.pk)
        self._add_item(mentor_access, collection_id, "sop", sop_b.pk)

        detail = self.client.get(reverse("knowledge-sop-detail", args=[sop_a.id]), **self._auth(mentor_access)).data
        self.assertEqual(len(detail["collections"]), 1)
        context = detail["collections"][0]
        self.assertEqual(context["id"], collection_id)
        self.assertEqual(context["position"], 1)
        self.assertEqual(context["total"], 2)
        self.assertIsNone(context["prev_item"])
        self.assertEqual(context["next_item"]["id"], str(sop_b.pk))

        detail = self.client.get(reverse("knowledge-sop-detail", args=[sop_b.id]), **self._auth(mentor_access)).data
        context = detail["collections"][0]
        self.assertEqual(context["prev_item"]["id"], str(sop_a.pk))
        self.assertIsNone(context["next_item"])

    def test_restricted_content_is_hidden_from_unprivileged_viewers_everywhere(self):
        mentor, mentor_access = self._login_with_role("colscope@example.com", "Mentor")
        collection_id = self._create_series(mentor_access).data["id"]
        public_sop = self._sop("Open Wing")
        restricted_sop = self._sop("Secret Wing", visibility="RESTRICTED", created_by=mentor)
        self._add_item(mentor_access, collection_id, "sop", public_sop.pk)
        self._add_item(mentor_access, collection_id, "sop", restricted_sop.pk)

        _, member_access = self._login_with_role("colviewer@example.com", "Member")

        # The collection detail only ever lists what this viewer can see.
        detail = self.client.get(
            reverse("knowledge-collection-detail", args=[collection_id]), **self._auth(member_access)
        ).data
        self.assertEqual([item["content"]["title"] for item in detail["items"]], ["Open Wing"])

        # So the phase stepper on the public SOP never links into the secret one.
        context = self.client.get(
            reverse("knowledge-sop-detail", args=[public_sop.id]), **self._auth(member_access)
        ).data["collections"][0]
        self.assertEqual((context["position"], context["total"]), (1, 1))
        self.assertIsNone(context["next_item"])

        # The mentor (allowed via the type's override permission) still sees both.
        detail = self.client.get(
            reverse("knowledge-collection-detail", args=[collection_id]), **self._auth(mentor_access)
        ).data
        self.assertEqual(len(detail["items"]), 2)
        context = self.client.get(
            reverse("knowledge-sop-detail", args=[public_sop.id]), **self._auth(mentor_access)
        ).data["collections"][0]
        self.assertEqual(context["total"], 2)
        self.assertEqual(context["next_item"]["id"], str(restricted_sop.pk))

    def test_restricted_collection_is_hidden_from_unprivileged_viewers(self):
        _, mentor_access = self._login_with_role("colprivate@example.com", "Mentor")
        collection_id = self._create_series(mentor_access, visibility="RESTRICTED").data["id"]

        _, member_access = self._login_with_role("colpeeker@example.com", "Member")
        response = self.client.get(
            reverse("knowledge-collection-detail", args=[collection_id]), **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # ...and it never appears in the member's collection list either.
        response = self.client.get(reverse("knowledge-collection-list"), **self._auth(member_access))
        self.assertEqual(response.data["count"], 0)

    def test_trashing_hides_a_collection_item_and_purging_removes_it(self):
        mentor, mentor_access = self._login_with_role("colprune@example.com", "Mentor")
        admin, admin_access = self._login_with_role("colpruneadmin@example.com", "Organization Admin")
        collection_id = self._create_series(mentor_access).data["id"]
        sop = self._sop("Ephemeral Wing")
        self._add_item(mentor_access, collection_id, "sop", sop.pk)
        self.assertEqual(CollectionItem.objects.filter(collection_id=collection_id).count(), 1)

        response = self.client.delete(reverse("knowledge-sop-detail", args=[sop.id]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        # In the trash: hidden from the series, but its place is kept for a restore.
        collection = Collection.objects.get(pk=collection_id)
        self.assertEqual(services.collection_items_for(collection, mentor), [])
        self.assertEqual(CollectionItem.objects.filter(collection_id=collection_id).count(), 1)

        # Purged: the phase entry goes with it (generic FKs don't cascade).
        trash.purge(model_name="sop", instance=Sop.all_objects.get(pk=sop.pk), actor=admin)
        self.assertEqual(CollectionItem.objects.filter(collection_id=collection_id).count(), 0)

    def test_other_organizations_admin_gets_404_on_collections(self):
        other_org = create_test_organization(name="Other Col Org")
        collection = Collection.objects.create(organization=self.organization, title="Theirs", slug="theirs")
        CollectionItem.objects.create(
            collection=collection,
            content_type=ContentType.objects.get_for_model(Sop),
            object_id=self._sop("Home SOP").pk,
            order=0,
        )

        _, other_access = self._login_with_role("othercoladmin@example.com", "Organization Admin", other_org)
        response = self.client.get(
            reverse("knowledge-collection-detail", args=[collection.id]), **self._auth(other_access)
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class MalformedIdFilterTests(KnowledgeTestCase):
    """?category=<not a uuid> used to reach the UUID column lookup and 500."""

    def test_malformed_category_filter_is_a_400_on_every_list(self):
        _, access = self._login_with_role("idfilter@example.com", "Organization Admin")
        names = [
            "knowledge-collection-list",
            "knowledge-sop-list-create",
            "knowledge-document-list-create",
            "knowledge-component-list-create",
            "training-course-list-create",
            "training-search",
        ]
        for name in names:
            with self.subTest(name=name):
                response = self.client.get(reverse(name), {"category": "not-a-uuid", "q": "x"}, **self._auth(access))
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn("category", response.data)
                ok = self.client.get(reverse(name), {"category": str(uuid.uuid4())}, **self._auth(access))
                self.assertEqual(ok.status_code, status.HTTP_200_OK)


class NamedGetOrCreateRaceTests(KnowledgeTestCase):
    """Two requests naming the same new storage location / component category
    at once both miss the lookup; the slower insert hits the unique constraint
    and must reuse the other request's row instead of returning a 500."""

    def _first_lookup_misses(self):
        real_first = QuerySet.first
        calls = {"count": 0}

        def first(queryset):
            calls["count"] += 1
            return None if calls["count"] == 1 else real_first(queryset)

        return mock.patch.object(QuerySet, "first", first)

    def test_storage_location_race_reuses_the_existing_row(self):
        head, _ = self._login_with_role("head_loc_race@example.com", "Subteam Head")
        existing = services.create_storage_location(actor=head, name="Shelf A")
        with self._first_lookup_misses():
            location = services.get_or_create_storage_location("shelf a", actor=head)
        self.assertEqual(location.pk, existing.pk)

    def test_component_category_race_reuses_the_existing_row(self):
        head, _ = self._login_with_role("head_cat_race@example.com", "Subteam Head")
        existing = services.create_component_category(actor=head, name="Avionics")
        with self._first_lookup_misses():
            category = services.get_or_create_component_category("Avionics", actor=head)
        self.assertEqual(category.pk, existing.pk)


class TrashTests(KnowledgeTestCase):
    def _draft(self, access, title="Trash me"):
        response = self.client.post(
            reverse("knowledge-article-list-create"),
            {"title": title, "content": "Body"},
            format="json",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.data

    def _delete(self, article, access):
        return self.client.delete(reverse("knowledge-article-detail", args=[article["id"]]), **self._auth(access))

    def _trash(self, access, **params):
        response = self.client.get(reverse("knowledge-trash-list"), params, **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["results"]

    def test_delete_moves_to_trash_and_restore_brings_it_back(self):
        author, access = self._login_with_role("trashauthor@example.com", "Member")
        article = self._draft(access)
        self.assertEqual(self._delete(article, access).status_code, status.HTTP_204_NO_CONTENT)

        detail = reverse("knowledge-article-detail", args=[article["id"]])
        self.assertEqual(self.client.get(detail, **self._auth(access)).status_code, status.HTTP_404_NOT_FOUND)
        listed = self.client.get(reverse("knowledge-article-list-create"), {"status": "ALL"}, **self._auth(access))
        self.assertNotIn(article["id"], {a["id"] for a in listed.data["results"]})
        self.assertTrue(Article.all_objects.filter(pk=article["id"]).exists())

        [item] = self._trash(access)
        self.assertEqual((item["type"], item["id"], item["title"]), ("article", article["id"], "Trash me"))
        self.assertEqual(item["deleted_by"]["id"], str(author.id))
        self.assertIsNotNone(item["purge_at"])

        response = self.client.post(
            reverse("knowledge-trash-restore", args=["article", article["id"]]), **self._auth(access)
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(detail, **self._auth(access)).status_code, status.HTTP_200_OK)
        self.assertEqual(self._trash(access), [])
        actions = set(AuditLog.objects.filter(target_object_id=article["id"]).values_list("action", flat=True))
        self.assertTrue({"article.trash", "article.restore"} <= actions)

    def test_trash_is_private_to_the_deleter_unless_they_manage_the_type(self):
        _, access = self._login_with_role("trashowner@example.com", "Member")
        article = self._draft(access)
        self._delete(article, access)

        _, other_access = self._login_with_role("trashpeer@example.com", "Member")
        self.assertEqual(self._trash(other_access), [])
        restore = reverse("knowledge-trash-restore", args=["article", article["id"]])
        self.assertEqual(self.client.post(restore, **self._auth(other_access)).status_code, status.HTTP_404_NOT_FOUND)

        _, admin_access = self._login_with_role("trashadmin@example.com", "Organization Admin")
        self.assertEqual([i["id"] for i in self._trash(admin_access)], [article["id"]])

    def test_permanent_delete_requires_trash_purge(self):
        _, access = self._login_with_role("purgeauthor@example.com", "Member")
        article = self._draft(access)
        self._delete(article, access)
        url = reverse("knowledge-trash-item", args=["article", article["id"]])
        self.assertEqual(self.client.delete(url, **self._auth(access)).status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("purgeadmin@example.com", "Organization Admin")
        self.assertEqual(self.client.delete(url, **self._auth(admin_access)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Article.all_objects.filter(pk=article["id"]).exists())

    def test_live_items_are_not_reachable_through_the_trash_endpoints(self):
        _, admin_access = self._login_with_role("liveadmin@example.com", "Organization Admin")
        article = self._draft(admin_access)
        url = reverse("knowledge-trash-item", args=["article", article["id"]])
        self.assertEqual(self.client.delete(url, **self._auth(admin_access)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Article.objects.filter(pk=article["id"]).exists())
        bad_type = reverse("knowledge-trash-item", args=["sop", article["id"]])
        self.assertEqual(
            self.client.delete(bad_type, **self._auth(admin_access)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_expired_items_are_purged_and_recent_ones_kept(self):
        _, access = self._login_with_role("expiry@example.com", "Member")
        old, recent = self._draft(access, "Old"), self._draft(access, "Recent")
        self._delete(old, access)
        self._delete(recent, access)
        now = timezone.now()
        Article.all_objects.filter(pk=old["id"]).update(deleted_at=now - datetime.timedelta(days=31))
        Article.all_objects.filter(pk=recent["id"]).update(deleted_at=now - datetime.timedelta(days=29))

        self.assertEqual(trash.purge_expired(), 1)
        self.assertFalse(Article.all_objects.filter(pk=old["id"]).exists())
        self.assertTrue(Article.all_objects.filter(pk=recent["id"]).exists())

    def test_trashed_article_keeps_its_slug(self):
        _, access = self._login_with_role("slugtrash@example.com", "Member")
        first = self._draft(access, "Same Title")
        self._delete(first, access)
        second = self._draft(access, "Same Title")
        self.assertNotEqual(first["slug"], second["slug"])

    def test_collection_hides_a_trashed_item_without_losing_its_place(self):
        author, _ = self._login_with_role("seriestrash@example.com", "Subteam Head")
        article = Article.objects.create(
            organization=self.organization,
            title="In a series",
            slug="in-a-series",
            author=author,
            status=Article.Status.PUBLISHED,
        )
        collection = Collection.objects.create(
            organization=self.organization, title="Series", slug="series", created_by=author
        )
        CollectionItem.objects.create(
            collection=collection,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=article.pk,
            order=0,
        )
        trash.move_to_trash(model_name="article", instance=article, actor=author)
        self.assertEqual(services.collection_items_for(collection, author), [])
        self.assertEqual(collection.items.count(), 1)

        trash.restore(model_name="article", instance=Article.all_objects.get(pk=article.pk), actor=author)
        self.assertEqual(len(services.collection_items_for(collection, author)), 1)

    def test_question_delete_goes_to_trash_visible_to_moderators(self):
        _, asker_access = self._login_with_role("trashasker@example.com", "Member")
        question = self.client.post(
            reverse("knowledge-question-list-create"),
            {"title": "Deleted question", "body": "..."},
            format="json",
            **self._auth(asker_access),
        ).data
        response = self.client.delete(
            reverse("knowledge-question-detail", args=[question["id"]]), **self._auth(asker_access)
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Question.objects.filter(pk=question["id"]).exists())

        _, mentor_access = self._login_with_role("trashmentor@example.com", "Mentor")
        self.assertEqual([i["id"] for i in self._trash(mentor_access, type="question")], [question["id"]])
        self.assertEqual(self._trash(mentor_access, type="article"), [])


class EngineeringTrashTests(KnowledgeTestCase):
    def test_trashed_project_disappears_from_tests_and_comes_back_on_restore(self):
        head, head_access = self._login_with_role("engtrash@example.com", "Subteam Head")
        project = Project.objects.create(organization=self.organization, name="Glider", created_by=head)
        test = Test.objects.create(organization=self.organization, title="Drop test", project=project, created_by=head)

        response = self.client.delete(reverse("knowledge-project-detail", args=[project.pk]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(
            self.client.get(
                reverse("knowledge-project-detail", args=[project.pk]), **self._auth(head_access)
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        # The test keeps its link (project_id) but shows no project while it's in the trash.
        self.assertEqual(Test.objects.get(pk=test.pk).project_id, project.pk)
        detail = self.client.get(reverse("knowledge-test-detail", args=[test.pk]), **self._auth(head_access))
        self.assertIsNone(detail.data["project"])

        [item] = self.client.get(reverse("knowledge-trash-list"), {"type": "project"}, **self._auth(head_access)).data[
            "results"
        ]
        self.assertEqual(item["title"], "Glider")
        self.client.post(reverse("knowledge-trash-restore", args=["project", project.pk]), **self._auth(head_access))
        detail = self.client.get(reverse("knowledge-test-detail", args=[test.pk]), **self._auth(head_access))
        self.assertEqual(detail.data["project"]["id"], str(project.pk))

    def test_every_engineering_type_goes_to_the_trash(self):
        _, admin_access = self._login_with_role("engtrashadmin@example.com", "Organization Admin")
        org = self.organization
        items = {
            "component": Component.objects.create(organization=org, name="Servo"),
            "failure": Failure.objects.create(organization=org, title="Snapped spar"),
            "sop": Sop.objects.create(organization=org, title="Battery charging"),
            "test": Test.objects.create(organization=org, title="Thrust test"),
            "document": Document.objects.create(organization=org, title="Rules"),
        }
        for name, instance in items.items():
            response = self.client.delete(
                reverse(f"knowledge-{name}-detail", args=[instance.pk]), **self._auth(admin_access)
            )
            self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, name)
            self.assertFalse(type(instance).objects.filter(pk=instance.pk).exists(), name)
            self.assertTrue(type(instance).all_objects.filter(pk=instance.pk).exists(), name)
        listed = self.client.get(reverse("knowledge-trash-list"), {"page_size": 50}, **self._auth(admin_access))
        self.assertEqual({item["type"] for item in listed.data["results"]}, set(items))


class ShareLinkTests(KnowledgeTestCase):
    def setUp(self):
        from organization.models import OrganizationSettings

        settings_row = OrganizationSettings.load(self.organization)
        settings_row.share_links_enabled = True
        settings_row.save()

    def _published_article(self, author, **fields):
        defaults = {"title": "Shared wing guide", "content": "Body", "status": Article.Status.PUBLISHED}
        return Article.objects.create(
            organization=self.organization, slug=f"a-{uuid.uuid4().hex[:8]}", author=author, **{**defaults, **fields}
        )

    def _create(self, access, obj, model_name="article", **extra):
        return self.client.post(
            reverse("knowledge-share-link-list-create"),
            {"type": model_name, "object_id": str(obj.pk), **extra},
            format="json",
            **self._auth(access),
        )

    def _open(self, token):
        return self.client.get(reverse("public-share", args=[token]))

    def test_head_shares_a_published_article_that_opens_without_login(self):
        head, access = self._login_with_role("sharehead@example.com", "Subteam Head")
        article = self._published_article(head)
        response = self._create(access, article, label="Sponsor")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(response.data["expires_at"])  # 30 days by default

        opened = self._open(response.data["token"])
        self.assertEqual(opened.status_code, status.HTTP_200_OK)
        self.assertEqual(opened.data["title"], "Shared wing guide")
        self.assertNotIn("email", str(opened.data))
        self.assertEqual(opened["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual(ShareLink.objects.get(pk=response.data["id"]).view_count, 1)
        # The same visitor opening it again right away isn't a second view...
        self._open(response.data["token"])
        self.assertEqual(ShareLink.objects.get(pk=response.data["id"]).view_count, 1)
        # ...a different visitor is.
        self.client.get(reverse("public-share", args=[response.data["token"]]), HTTP_USER_AGENT="Other browser")
        self.assertEqual(ShareLink.objects.get(pk=response.data["id"]).view_count, 2)

    def test_creation_rules(self):
        head, head_access = self._login_with_role("sharerules@example.com", "Subteam Head")
        _, member_access = self._login_with_role("sharemember@example.com", "Member")
        article = self._published_article(head)
        # Members lack share_link.create.
        self.assertEqual(self._create(member_access, article).status_code, status.HTTP_403_FORBIDDEN)
        # Drafts can't be shared.
        draft = self._published_article(head, status=Article.Status.DRAFT)
        self.assertEqual(self._create(head_access, draft).status_code, status.HTTP_400_BAD_REQUEST)
        # Only the listed expiry choices.
        self.assertEqual(self._create(head_access, article, expires_in_days=5).status_code, status.HTTP_400_BAD_REQUEST)
        never = self._create(head_access, article, expires_in_days=None)
        self.assertEqual(never.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(never.data["expires_at"])

    def test_switched_off_organization_blocks_creating_and_opening(self):
        from organization.models import OrganizationSettings

        head, access = self._login_with_role("shareoff@example.com", "Subteam Head")
        token = self._create(access, self._published_article(head)).data["token"]
        OrganizationSettings.objects.filter(organization=self.organization).update(share_links_enabled=False)
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self._create(access, self._published_article(head)).status_code, status.HTTP_403_FORBIDDEN)

    def test_restricted_article_needs_article_update_to_share(self):
        head, head_access = self._login_with_role("sharerestricted@example.com", "Subteam Head")
        restricted = self._published_article(head, visibility=Visibility.RESTRICTED)
        # Subteam Head has article.update (via Mentor) - allowed.
        self.assertEqual(self._create(head_access, restricted).status_code, status.HTTP_201_CREATED)

        role = Role.objects.create(organization=self.organization, name="Sharer only")
        from rbac.models import Permission

        for codename in ("article.read", "share_link.create"):
            role.permissions.add(Permission.objects.get(codename=codename))
        sharer, sharer_access = self._login_with_role("sharersonly@example.com", "Sharer only")
        own_restricted = self._published_article(sharer, visibility=Visibility.RESTRICTED)
        self.assertEqual(self._create(sharer_access, own_restricted).status_code, status.HTTP_403_FORBIDDEN)

        # A link made while public stops once the item turns restricted.
        public = self._published_article(sharer)
        token = self._create(sharer_access, public).data["token"]
        self.assertEqual(self._open(token).status_code, status.HTTP_200_OK)
        Article.objects.filter(pk=public.pk).update(visibility=Visibility.RESTRICTED)
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)

    def test_link_stops_when_revoked_expired_unpublished_or_trashed(self):
        head, access = self._login_with_role("sharestop@example.com", "Subteam Head")

        def fresh():
            article = self._published_article(head)
            data = self._create(access, article).data
            return article, data["id"], data["token"]

        _, link_id, token = fresh()
        revoke = self.client.post(reverse("knowledge-share-link-revoke", args=[link_id]), **self._auth(access))
        self.assertEqual(revoke.status_code, status.HTTP_200_OK)
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)

        _, link_id, token = fresh()
        ShareLink.objects.filter(pk=link_id).update(expires_at=timezone.now() - datetime.timedelta(seconds=1))
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)

        article, _, token = fresh()
        Article.objects.filter(pk=article.pk).update(status=Article.Status.ARCHIVED)
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)

        article, _, token = fresh()
        trash.move_to_trash(model_name="article", instance=article, actor=head)
        self.assertEqual(self._open(token).status_code, status.HTTP_404_NOT_FOUND)

    def test_forged_and_malformed_tokens_are_404(self):
        head, access = self._login_with_role("shareforge@example.com", "Subteam Head")
        token = self._create(access, self._published_article(head)).data["token"]
        forged = token[:32] + ("0" if token[-1] != "0" else "1") * 32
        self.assertEqual(self._open(forged).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self._open("not-a-token").status_code, status.HTTP_404_NOT_FOUND)

    def test_only_creator_or_manager_sees_and_revokes(self):
        head, head_access = self._login_with_role("sharecreator@example.com", "Subteam Head")
        _, other_access = self._login_with_role("shareotherhead@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("shareadmin@example.com", "Organization Admin")
        link_id = self._create(head_access, self._published_article(head)).data["id"]

        listed = self.client.get(reverse("knowledge-share-link-list-create"), **self._auth(other_access))
        self.assertEqual(listed.data["results"], [])
        revoke = reverse("knowledge-share-link-revoke", args=[link_id])
        self.assertEqual(self.client.post(revoke, **self._auth(other_access)).status_code, status.HTTP_404_NOT_FOUND)

        listed = self.client.get(reverse("knowledge-share-link-list-create"), **self._auth(admin_access))
        self.assertEqual([link["id"] for link in listed.data["results"]], [link_id])
        self.assertEqual(self.client.post(revoke, **self._auth(admin_access)).status_code, status.HTTP_200_OK)

    def test_public_file_route_serves_only_the_shared_items_files(self):
        head, access = self._login_with_role("sharefiles@example.com", "Subteam Head")
        inline = StoredFile.objects.create(
            organization=self.organization,
            file=SimpleUploadedFile("inline.txt", b"inline"),
            original_filename="inline.txt",
            content_type="text/plain",
        )
        attached = StoredFile.objects.create(
            organization=self.organization,
            file=SimpleUploadedFile("attached.txt", b"attached"),
            original_filename="attached.txt",
            content_type="text/plain",
        )
        unrelated = StoredFile.objects.create(
            organization=self.organization,
            file=SimpleUploadedFile("secret.txt", b"secret"),
            original_filename="secret.txt",
            content_type="text/plain",
        )
        article = self._published_article(head, content=f"See [notes](/api/v1/files/{inline.pk}/download/)")
        ArticleAttachment.objects.create(article=article, file=attached, uploaded_by=head)
        token = self._create(access, article).data["token"]

        opened = self._open(token)
        self.assertEqual([a["original_filename"] for a in opened.data["attachments"]], ["attached.txt"])
        for stored_file, expected in ((inline, 200), (attached, 200), (unrelated, 404)):
            response = self.client.get(reverse("public-share-file", args=[token, stored_file.pk]))
            self.assertEqual(response.status_code, expected, stored_file.original_filename)
            if expected == 200:
                b"".join(response.streaming_content)
        for stored_file in (inline, attached, unrelated):
            stored_file.file.delete(save=False)

    def test_sop_can_be_shared(self):
        head, access = self._login_with_role("sharesop@example.com", "Subteam Head")
        sop = Sop.objects.create(
            organization=self.organization,
            title="Battery charging",
            content="Steps",
            safety_notes="Gloves",
            created_by=head,
        )
        token = self._create(access, sop, model_name="sop").data["token"]
        opened = self._open(token)
        self.assertEqual(opened.status_code, status.HTTP_200_OK)
        self.assertEqual((opened.data["type"], opened.data["safety_notes"]), ("sop", "Gloves"))
