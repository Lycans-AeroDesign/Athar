from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from audit.models import AuditLog
from rbac.models import Role

from .models import (
    Answer,
    Article,
    ArticleAttachment,
    ArticleRevision,
    Category,
    Component,
    Document,
    Failure,
    KnowledgeRelation,
    Project,
    Question,
    QuestionAttachment,
    Sop,
    Tag,
    Test,
)


class KnowledgeTestCase(APITestCase):
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

        _, senior_access = self._login_with_role("senior@example.com", "Senior Member")
        response = self.client.post(
            reverse("knowledge-article-publish", args=[article_id]), **self._auth(senior_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, head_access = self._login_with_role("head@example.com", "Team/Subteam Head")
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

        # A Senior Member (question.moderate) can also accept, on someone else's question.
        _, moderator_access = self._login_with_role("moderator@example.com", "Senior Member")
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

        _, senior_access = self._login_with_role("rejsenior@example.com", "Senior Member")
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

        _, head_access = self._login_with_role("archhead@example.com", "Team/Subteam Head")
        response = self.client.post(
            reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access)
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))

        _, senior_access = self._login_with_role("archsenior@example.com", "Senior Member")
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

        _, head_access = self._login_with_role("unarchhead@example.com", "Team/Subteam Head")
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

        _, senior_access = self._login_with_role("unarchsenior@example.com", "Senior Member")
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

        _, head_access = self._login_with_role("frozenhead@example.com", "Team/Subteam Head")
        self.client.post(reverse("knowledge-article-submit", args=[article["id"]]), **self._auth(author_access))
        self.client.post(reverse("knowledge-article-publish", args=[article["id"]]), **self._auth(head_access))
        self.client.post(reverse("knowledge-article-archive", args=[article["id"]]), **self._auth(head_access))

        # Team/Subteam Head holds article.update (a blanket override) - even
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

        _, head_access = self._login_with_role("allhead@example.com", "Team/Subteam Head")
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

        _, head_access = self._login_with_role("searchhead@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("searchsort@example.com", "Team/Subteam Head")
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

        # Default (no ?sort=) matches ?sort=newest.
        response = self.client.get(reverse("knowledge-search") + "?q=sortex", **self._auth(head_access))
        self.assertEqual([r["id"] for r in response.data["results"]], [newer["id"], older["id"]])

        response = self.client.get(reverse("knowledge-search") + "?q=sortex&sort=oldest", **self._auth(head_access))
        self.assertEqual([r["id"] for r in response.data["results"]], [older["id"], newer["id"]])

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

        _, moderator_access = self._login_with_role("searchrestrictedqmod@example.com", "Senior Member")
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
        _, head_access = self._login_with_role("searchrestrictedahead@example.com", "Team/Subteam Head")
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

        _, head_access = self._login_with_role("vishead@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("relvishead@example.com", "Team/Subteam Head")
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
        _, moderator_access = self._login_with_role("relvismod@example.com", "Senior Member")
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
        _, head_access = self._login_with_role("semrelhead@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("semrelhead2@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("semrelhead3@example.com", "Team/Subteam Head")
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

        _, head_access = self._login_with_role("projhead@example.com", "Team/Subteam Head")
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

        _, senior_access = self._login_with_role("compsenior@example.com", "Senior Member")
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

        _, head_access = self._login_with_role("comphead@example.com", "Team/Subteam Head")
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

        _, senior_access = self._login_with_role("failsenior@example.com", "Senior Member")
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
        _, head_access = self._login_with_role("failhead@example.com", "Team/Subteam Head")
        response = self.client.delete(reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("failadmin@example.com", "Organization Admin")
        response = self.client.delete(reverse("knowledge-failure-detail", args=[failure["id"]]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Failure.objects.exists())

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

        _, senior_access = self._login_with_role("sopsenior@example.com", "Senior Member")
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

        _, senior_access = self._login_with_role("testsenior@example.com", "Senior Member")
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

        _, head_access = self._login_with_role("testhead@example.com", "Team/Subteam Head")
        response = self.client.delete(reverse("knowledge-test-detail", args=[test["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Test.objects.exists())

    def test_test_relations_and_search(self):
        _, head_access = self._login_with_role("testrel@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("relhead@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("searcheng@example.com", "Team/Subteam Head")
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
        _, head_access = self._login_with_role("qsearcheng@example.com", "Team/Subteam Head")

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
        owner, owner_access = self._login_with_role("profileowner@example.com", "Team/Subteam Head")
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

        # The viewer's own profile shows their answer, and that it was accepted.
        response = self.client.get(reverse("knowledge-user-profile", args=[viewer.id]), **self._auth(viewer_access))
        self.assertEqual(response.data["stats"]["answer"], 1)
        self.assertEqual(response.data["stats"]["accepted_answers"], 1)

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

        # A Senior Member (document.update) can edit and delete someone else's document.
        _, senior_access = self._login_with_role("docsenior@example.com", "Senior Member")
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

    def test_restricted_document_hidden_from_list_search_and_relations(self):
        owner, owner_access = self._login_with_role("docrestowner@example.com", "Member")
        document = self.client.post(
            reverse("knowledge-document-list-create"),
            {"title": "Zephyrix Sponsor Budget", "visibility": "RESTRICTED"},
            format="json",
            **self._auth(owner_access),
        ).data
        # Project creation needs project.create (Team/Subteam Head only, see
        # EngineeringDomainTests) - a separate account from the document
        # owner just to get a project to relate to; the relation itself is
        # created from the document owner's side below, which only needs
        # edit rights on the *source* (the document), not the target.
        _, head_access = self._login_with_role("docresthead@example.com", "Team/Subteam Head")
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
        _, senior_access = self._login_with_role("docrestsenior@example.com", "Senior Member")
        for access in (owner_access, senior_access):
            response = self.client.get(reverse("knowledge-document-detail", args=[document["id"]]), **self._auth(access))
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            response = self.client.get(reverse("knowledge-project-relations", args=[project["id"]]), **self._auth(access))
            self.assertEqual([r["other_id"] for r in response.data], [document["id"]])
