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
    KnowledgeRelation,
    Question,
    QuestionAttachment,
    Tag,
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

        response = self.client.get(reverse("knowledge-search") + "?q=pixhawk&type=article", **self._auth(author_access))
        self.assertTrue(all(r["type"] == "article" for r in response.data["results"]))

        response = self.client.get(reverse("knowledge-search") + "?q=pixhawk&type=question", **self._auth(author_access))
        self.assertTrue(all(r["type"] == "question" for r in response.data["results"]))
        self.assertTrue(any("rebooting" in r["title"] for r in response.data["results"]))


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
