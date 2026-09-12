from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from core.testing import create_test_organization
from knowledge import services as knowledge_services
from rbac.models import Role

from .models import Course, CourseCategory, CourseEnrollment, CourseModule, CourseResource, Lesson, LessonProgress


class TrainingTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login_with_role(self, email, role_name, organization=None):
        organization = organization or self.organization
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(reverse("auth-login"), {"email": email, "password": "password123"}, format="json")
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def _create_course(self, access_token, title="ANSYS Fundamentals"):
        return self.client.post(
            reverse("training-course-list-create"), {"title": title}, format="json", **self._auth(access_token)
        ).data

    def _create_module(self, access_token, course_id, title="Module 1"):
        return self.client.post(
            reverse("training-module-list-create", args=[course_id]), {"title": title}, format="json",
            **self._auth(access_token),
        ).data

    def _create_lesson(self, access_token, module_id, title="Lesson 1", **extra):
        payload = {"title": title, **extra}
        return self.client.post(
            reverse("training-lesson-list-create", args=[module_id]), payload, format="json", **self._auth(access_token)
        ).data

    def _publish_course(self, access_token, course_id):
        return self.client.post(reverse("training-course-publish", args=[course_id]), **self._auth(access_token))


class CourseLifecycleTests(TrainingTestCase):
    def test_draft_only_visible_to_author_and_managers(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)

        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.get(reverse("training-course-detail", args=[course["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(reverse("training-course-detail", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_submit_publish_reject_archive_unarchive_cycle(self):
        _, mentor_access = self._login_with_role("mentor@example.com", "Mentor")
        course = self._create_course(mentor_access)
        self.assertEqual(course["status"], Course.Status.DRAFT)

        response = self.client.post(reverse("training-course-submit", args=[course["id"]]), **self._auth(mentor_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Course.Status.IN_REVIEW)

        _, head_access = self._login_with_role("head2@example.com", "Subteam Head")
        response = self.client.post(
            reverse("training-course-reject", args=[course["id"]]), {"reason": "needs more detail"},
            format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Course.Status.REJECTED)

        response = self.client.post(reverse("training-course-submit", args=[course["id"]]), **self._auth(mentor_access))
        self.assertEqual(response.data["status"], Course.Status.IN_REVIEW)

        response = self.client.post(reverse("training-course-publish", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], Course.Status.PUBLISHED)
        self.assertIsNotNone(response.data["published_at"])

        response = self.client.post(reverse("training-course-archive", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.data["status"], Course.Status.ARCHIVED)

        response = self.client.patch(
            reverse("training-course-detail", args=[course["id"]]), {"title": "New title"}, format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(reverse("training-course-unarchive", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.data["status"], Course.Status.PUBLISHED)


class CoursePermissionTests(TrainingTestCase):
    def test_member_cannot_create_or_publish(self):
        _, guest_access = self._login_with_role("guest@example.com", "Guest")
        response = self.client.post(
            reverse("training-course-list-create"), {"title": "X"}, format="json", **self._auth(guest_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.post(
            reverse("training-course-list-create"), {"title": "X"}, format="json", **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_mentor_can_create_and_edit_own_draft_but_not_publish(self):
        _, mentor_access = self._login_with_role("mentor@example.com", "Mentor")
        course = self._create_course(mentor_access)
        self.assertEqual(course["status"], Course.Status.DRAFT)

        response = self.client.patch(
            reverse("training-course-detail", args=[course["id"]]), {"title": "Updated"}, format="json",
            **self._auth(mentor_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.post(reverse("training-course-publish", args=[course["id"]]), **self._auth(mentor_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_subteam_head_can_publish_and_archive(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        response = self.client.post(reverse("training-course-publish", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.post(reverse("training-course-archive", args=[course["id"]]), **self._auth(head_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_only_admin_can_force_delete_non_own_course(self):
        _, mentor_access = self._login_with_role("mentor@example.com", "Mentor")
        course = self._create_course(mentor_access)
        self._publish_course(mentor_access, course["id"])

        _, other_mentor_access = self._login_with_role("mentor2@example.com", "Mentor")
        response = self.client.delete(
            reverse("training-course-detail", args=[course["id"]]), **self._auth(other_mentor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("admin@example.com", "Organization Admin")
        response = self.client.delete(reverse("training-course-detail", args=[course["id"]]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_own_draft_deletable_without_special_permission(self):
        _, mentor_access = self._login_with_role("mentor@example.com", "Mentor")
        course = self._create_course(mentor_access)
        response = self.client.delete(reverse("training-course-detail", args=[course["id"]]), **self._auth(mentor_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class CourseCategoryTests(TrainingTestCase):
    def test_manage_permission_required_to_create_and_delete(self):
        _, mentor_access = self._login_with_role("mentor@example.com", "Mentor")
        response = self.client.post(
            reverse("training-category-list"), {"name": "Robotics"}, format="json", **self._auth(mentor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _, admin_access = self._login_with_role("admin@example.com", "Organization Admin")
        response = self.client.post(
            reverse("training-category-list"), {"name": "Robotics"}, format="json", **self._auth(admin_access)
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        category_id = response.data["id"]

        response = self.client.delete(
            reverse("training-category-detail", args=[category_id]), **self._auth(mentor_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.delete(reverse("training-category-detail", args=[category_id]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class ModuleLessonOrderingTests(TrainingTestCase):
    def test_module_and_lesson_order_unique_and_sequential(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        module_a = self._create_module(head_access, course["id"], "Module A")
        module_b = self._create_module(head_access, course["id"], "Module B")
        self.assertEqual(module_a["order"], 0)
        self.assertEqual(module_b["order"], 1)

        lesson_1 = self._create_lesson(head_access, module_a["id"], "Lesson 1")
        lesson_2 = self._create_lesson(head_access, module_a["id"], "Lesson 2")
        self.assertEqual(lesson_1["order"], 0)
        self.assertEqual(lesson_2["order"], 1)

    def test_reorder_endpoint_normalizes_order_and_rejects_mismatched_sets(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        module_a = self._create_module(head_access, course["id"], "Module A")
        module_b = self._create_module(head_access, course["id"], "Module B")

        response = self.client.post(
            reverse("training-module-reorder", args=[course["id"]]),
            {"order": [module_b["id"], module_a["id"]]}, format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["id"], module_b["id"])
        self.assertEqual(response.data[0]["order"], 0)
        self.assertEqual(response.data[1]["id"], module_a["id"])
        self.assertEqual(response.data[1]["order"], 1)

        response = self.client.post(
            reverse("training-module-reorder", args=[course["id"]]),
            {"order": [module_a["id"]]}, format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reordering_does_not_change_lesson_identifiers(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        module = self._create_module(head_access, course["id"])
        lesson_1 = self._create_lesson(head_access, module["id"], "Lesson 1")
        lesson_2 = self._create_lesson(head_access, module["id"], "Lesson 2")

        self.client.post(
            reverse("training-lesson-reorder", args=[module["id"]]),
            {"order": [lesson_2["id"], lesson_1["id"]]}, format="json", **self._auth(head_access),
        )
        response = self.client.get(reverse("training-lesson-detail", args=[lesson_1["id"]]), **self._auth(head_access))
        self.assertEqual(response.data["id"], lesson_1["id"])
        self.assertEqual(response.data["order"], 1)


class CourseEnrollmentTests(TrainingTestCase):
    def test_enrollment_requires_published_course(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)

        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self._publish_course(head_access, course["id"])
        response = self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], CourseEnrollment.Status.IN_PROGRESS)

    def test_duplicate_enrollment_rejected(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        self._publish_course(head_access, course["id"])

        _, member_access = self._login_with_role("member@example.com", "Member")
        self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))
        response = self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CourseEnrollment.objects.filter(course_id=course["id"]).count(), 1)

    def test_cross_org_course_id_not_enrollable(self):
        other_org = create_test_organization(name="Other Org")
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        self._publish_course(head_access, course["id"])

        _, other_member_access = self._login_with_role("other-member@example.com", "Member", other_org)
        response = self.client.post(
            reverse("training-course-enroll", args=[course["id"]]), **self._auth(other_member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class LessonProgressTests(TrainingTestCase):
    def _setup_published_course_with_lessons(self, head_access, *, optional_last=True):
        course = self._create_course(head_access)
        module = self._create_module(head_access, course["id"])
        lesson_1 = self._create_lesson(head_access, module["id"], "Lesson 1")
        lesson_2 = self._create_lesson(head_access, module["id"], "Lesson 2")
        lesson_3 = self._create_lesson(head_access, module["id"], "Lesson 3", is_required=not optional_last)
        self._publish_course(head_access, course["id"])
        return course, [lesson_1, lesson_2, lesson_3]

    def test_mark_complete_is_idempotent(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course, lessons = self._setup_published_course_with_lessons(head_access, optional_last=False)
        _, member_access = self._login_with_role("member@example.com", "Member")
        self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))

        response = self.client.post(reverse("training-lesson-complete", args=[lessons[0]["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.post(reverse("training-lesson-complete", args=[lessons[0]["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(LessonProgress.objects.filter(lesson_id=lessons[0]["id"]).count(), 1)

    def test_un_enrolled_user_cannot_mark_complete(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course, lessons = self._setup_published_course_with_lessons(head_access)
        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.post(reverse("training-lesson-complete", args=[lessons[0]["id"]]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_progress_calculation_and_required_only_completion(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course, lessons = self._setup_published_course_with_lessons(head_access, optional_last=True)
        _, member_access = self._login_with_role("member@example.com", "Member")
        self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))

        self.client.post(reverse("training-lesson-complete", args=[lessons[0]["id"]]), **self._auth(member_access))
        response = self.client.get(reverse("training-course-progress", args=[course["id"]]), **self._auth(member_access))
        self.assertEqual(response.data["completed_lessons"], 1)
        self.assertEqual(response.data["total_lessons"], 3)
        self.assertEqual(response.data["status"], CourseEnrollment.Status.IN_PROGRESS)

        self.client.post(reverse("training-lesson-complete", args=[lessons[1]["id"]]), **self._auth(member_access))
        response = self.client.get(reverse("training-course-progress", args=[course["id"]]), **self._auth(member_access))
        # lessons[2] is optional and never completed - course should still
        # complete once every REQUIRED lesson is done.
        self.assertEqual(response.data["status"], CourseEnrollment.Status.COMPLETED)
        self.assertEqual(response.data["completed_required_lessons"], response.data["total_required_lessons"])
        self.assertLess(response.data["completed_lessons"], response.data["total_lessons"])


class CourseResourceTests(TrainingTestCase):
    def _lesson(self, head_access):
        course = self._create_course(head_access)
        module = self._create_module(head_access, course["id"])
        return self._create_lesson(head_access, module["id"])

    def test_external_link_requires_url_and_rejects_stored_file(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        lesson = self._lesson(head_access)
        response = self.client.post(
            reverse("training-resource-list-create", args=[lesson["id"]]),
            {"title": "Video", "resource_type": CourseResource.ResourceType.EXTERNAL_LINK},
            format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_stored_file_rejects_url_and_provider(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        lesson = self._lesson(head_access)
        response = self.client.post(
            reverse("training-resource-list-create", args=[lesson["id"]]),
            {
                "title": "Doc", "resource_type": CourseResource.ResourceType.STORED_FILE,
                "url": "https://example.com/x.pdf",
            },
            format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_one_primary_resource_per_lesson(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        lesson = self._lesson(head_access)
        first = self.client.post(
            reverse("training-resource-list-create", args=[lesson["id"]]),
            {
                "title": "Main Video", "resource_type": CourseResource.ResourceType.EXTERNAL_LINK,
                "provider": CourseResource.Provider.GOOGLE_DRIVE, "url": "https://drive.google.com/file/d/abc/view",
                "is_primary": True,
            },
            format="json", **self._auth(head_access),
        ).data
        second = self.client.post(
            reverse("training-resource-list-create", args=[lesson["id"]]),
            {
                "title": "Alt Video", "resource_type": CourseResource.ResourceType.EXTERNAL_LINK,
                "url": "https://example.com/alt.mp4", "is_primary": True,
            },
            format="json", **self._auth(head_access),
        ).data
        self.assertTrue(second["is_primary"])
        first_reloaded = CourseResource.objects.get(pk=first["id"])
        self.assertFalse(first_reloaded.is_primary)


class LessonKnowledgeReferenceTests(TrainingTestCase):
    def _lesson(self, head_access):
        course = self._create_course(head_access)
        module = self._create_module(head_access, course["id"])
        return self._create_lesson(head_access, module["id"])

    def test_allowlist_rejects_unknown_type(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        lesson = self._lesson(head_access)
        response = self.client.post(
            reverse("training-knowledge-reference-list-create", args=[lesson["id"]]),
            {"content_type": "component", "object_id": "00000000-0000-0000-0000-000000000000"},
            format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cross_org_target_not_found(self):
        other_org = create_test_organization(name="Other Org")
        other_head, _ = self._login_with_role("head-other@example.com", "Subteam Head", other_org)
        other_component = knowledge_services.create_component(actor=other_head, name="Other Org Motor")

        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        lesson = self._lesson(head_access)
        response = self.client.post(
            reverse("training-knowledge-reference-list-create", args=[lesson["id"]]),
            {"content_type": "component", "object_id": str(other_component.pk)},
            format="json", **self._auth(head_access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_restricted_reference_hidden_from_unprivileged_viewer(self):
        from knowledge.models import Visibility

        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        head_user = User.objects.get(email="head@example.com")
        restricted_component = knowledge_services.create_component(
            actor=head_user, name="Restricted Motor", visibility=Visibility.RESTRICTED
        )
        lesson = self._lesson(head_access)
        self.client.post(
            reverse("training-knowledge-reference-list-create", args=[lesson["id"]]),
            {"content_type": "component", "object_id": str(restricted_component.pk)},
            format="json", **self._auth(head_access),
        )

        response = self.client.get(
            reverse("training-knowledge-reference-list-create", args=[lesson["id"]]), **self._auth(head_access)
        )
        self.assertEqual(len(response.data), 1)

        _, member_access = self._login_with_role("member@example.com", "Member")
        self._publish_course(head_access, self.client.get(
            reverse("training-lesson-detail", args=[lesson["id"]]), **self._auth(head_access)
        ).data["course_id"])
        response = self.client.get(
            reverse("training-knowledge-reference-list-create", args=[lesson["id"]]), **self._auth(member_access)
        )
        self.assertEqual(len(response.data), 0)


class MultiTenancyIsolationTests(APITestCase):
    """Mirrors knowledge.tests.MultiTenancyIsolationTests's shape - two real
    independent organizations, proving a logged-in user from Organization A
    cannot read, list, enroll in, or reference anything belonging to
    Organization B, by guessed id or otherwise."""

    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Org A")
        cls.org_b = create_test_organization(name="Org B")

    def _login_with_role(self, email, role_name, organization):
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(reverse("auth-login"), {"email": email, "password": "password123"}, format="json")
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_courses_are_isolated(self):
        _, a_head_access = self._login_with_role("a-head@example.com", "Subteam Head", self.org_a)
        course = self.client.post(
            reverse("training-course-list-create"), {"title": "Org A Secret Course"}, format="json",
            **self._auth(a_head_access),
        ).data
        self.client.post(reverse("training-course-publish", args=[course["id"]]), **self._auth(a_head_access))

        _, b_head_access = self._login_with_role("b-head@example.com", "Subteam Head", self.org_b)
        response = self.client.get(reverse("training-course-list-create"), **self._auth(b_head_access))
        course_ids = [row["id"] for row in response.data["results"]]
        self.assertNotIn(course["id"], course_ids)

        response = self.client.get(reverse("training-course-detail", args=[course["id"]]), **self._auth(b_head_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.get(
            reverse("training-search") + "?q=Secret", **self._auth(b_head_access)
        )
        titles = [row["title"] for row in response.data["results"]]
        self.assertNotIn("Org A Secret Course", titles)

    def test_enrollment_and_progress_isolated(self):
        _, a_head_access = self._login_with_role("a-head@example.com", "Subteam Head", self.org_a)
        course = self.client.post(
            reverse("training-course-list-create"), {"title": "Org A Course"}, format="json", **self._auth(a_head_access)
        ).data
        self.client.post(reverse("training-course-publish", args=[course["id"]]), **self._auth(a_head_access))

        _, a_member_access = self._login_with_role("a-member@example.com", "Member", self.org_a)
        self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(a_member_access))

        _, b_member_access = self._login_with_role("b-member@example.com", "Member", self.org_b)
        response = self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(b_member_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.get(reverse("training-my-courses"), **self._auth(b_member_access))
        self.assertEqual(response.data["count"], 0)

    def test_course_category_creation_scoped_to_own_org(self):
        _, a_admin_access = self._login_with_role("a-admin@example.com", "Organization Admin", self.org_a)
        category = self.client.post(
            reverse("training-category-list"), {"name": "Robotics"}, format="json", **self._auth(a_admin_access)
        ).data

        _, b_admin_access = self._login_with_role("b-admin@example.com", "Organization Admin", self.org_b)
        response = self.client.get(reverse("training-category-list"), **self._auth(b_admin_access))
        category_ids = [row["id"] for row in response.data["results"]]
        self.assertNotIn(category["id"], category_ids)


class TrainingSearchTests(TrainingTestCase):
    def test_search_matches_title_and_excludes_drafts(self):
        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access, title="ROS 2 Fundamentals")
        response = self.client.get(reverse("training-search") + "?q=ROS", **self._auth(head_access))
        self.assertEqual(response.data["count"], 0)  # still draft

        self._publish_course(head_access, course["id"])
        _, member_access = self._login_with_role("member@example.com", "Member")
        response = self.client.get(reverse("training-search") + "?q=ROS", **self._auth(member_access))
        titles = [row["title"] for row in response.data["results"]]
        self.assertIn("ROS 2 Fundamentals", titles)


class TrainingAuditTests(TrainingTestCase):
    def test_key_actions_are_logged(self):
        from audit.models import AuditLog

        _, head_access = self._login_with_role("head@example.com", "Subteam Head")
        course = self._create_course(head_access)
        self._publish_course(head_access, course["id"])
        self.assertTrue(AuditLog.objects.filter(action="course.publish", organization=self.organization).exists())

        module = self._create_module(head_access, course["id"])
        lesson = self._create_lesson(head_access, module["id"])

        _, member_access = self._login_with_role("member@example.com", "Member")
        self.client.post(reverse("training-course-enroll", args=[course["id"]]), **self._auth(member_access))
        self.assertTrue(AuditLog.objects.filter(action="enrollment.create", organization=self.organization).exists())

        self.client.post(reverse("training-lesson-complete", args=[lesson["id"]]), **self._auth(member_access))
        self.assertTrue(AuditLog.objects.filter(action="lesson.complete", organization=self.organization).exists())
        self.assertTrue(AuditLog.objects.filter(action="course.complete", organization=self.organization).exists())
