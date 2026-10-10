import io
import zipfile

from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User
from files.models import StoredFile
from rbac.models import Role

from knowledge import services as knowledge_services
from knowledge.models import (
    Answer,
    Article,
    Bookmark,
    Component,
    ComponentCategory,
    KnowledgeRelation,
    Project,
    Question,
    RestrictedAccessGrant,
    StorageLocation,
    Tag,
)
from training.models import (
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseModule,
    CourseResource,
    LearningObjective,
    Lesson,
    LessonKnowledgeReference,
    LessonProgress,
)

from . import restore
from .models import BackupJob, RestoreJob


class BackupJobTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login_with_role(self, email, role_name, organization=None):
        organization = organization or self.organization
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}


class BackupJobPermissionTests(BackupJobTestCase):
    def test_only_organization_manage_can_create_list_or_view(self):
        _, member_access = self._login_with_role("backupmember@example.com", "Member")
        _, admin_access = self._login_with_role("backupadmin@example.com", "Organization Admin")

        response = self.client.post(reverse("backups-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(reverse("backups-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(reverse("backups-list-create"), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        job_id = response.data["id"]

        response = self.client.get(reverse("backups-detail", args=[job_id]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.get(reverse("backups-download", args=[job_id]), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        job = BackupJob.objects.get(pk=job_id)
        if job.archive:
            job.archive.delete(save=False)


class BackupJobCrossOrgIsolationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Backup Org A")
        cls.org_b = create_test_organization(name="Backup Org B")

    def _login_with_role(self, email, role_name, organization):
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_admin_cannot_see_or_download_another_orgs_backup_job(self):
        _, a_admin_access = self._login_with_role("a-backupadmin@example.com", "Organization Admin", self.org_a)
        _, b_admin_access = self._login_with_role("b-backupadmin@example.com", "Organization Admin", self.org_b)

        response = self.client.post(reverse("backups-list-create"), **self._auth(a_admin_access))
        job_id = response.data["id"]

        response = self.client.get(reverse("backups-detail", args=[job_id]), **self._auth(b_admin_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.get(reverse("backups-download", args=[job_id]), **self._auth(b_admin_access))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.get(reverse("backups-list-create"), **self._auth(b_admin_access))
        self.assertEqual(response.data["results"], [])

        job = BackupJob.objects.get(pk=job_id)
        if job.archive:
            job.archive.delete(save=False)


class BackupJobGenerationTests(BackupJobTestCase):
    """CELERY_TASK_ALWAYS_EAGER=True in tests (see config/settings.py) means
    .delay() below actually runs the task inline, synchronously - no real
    broker/worker needed for these."""

    def test_backup_job_runs_and_produces_a_downloadable_archive(self):
        author, author_access = self._login_with_role("backupauthor@example.com", "Subteam Head")
        self.client.post(
            reverse("knowledge-project-list-create"),
            {"name": "Backed Up Project", "description": "..."},
            format="json",
            **self._auth(author_access),
        )

        _, admin_access = self._login_with_role("backupgenadmin@example.com", "Organization Admin")
        response = self.client.post(reverse("backups-list-create"), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        job_id = response.data["id"]

        response = self.client.get(reverse("backups-detail", args=[job_id]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE")
        self.assertTrue(response.data["can_download"])

        response = self.client.get(reverse("backups-download", args=[job_id]), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/zip")

        archive_bytes = b"".join(response.streaming_content)
        job = BackupJob.objects.get(pk=job_id)
        try:
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
                names = zf.namelist()
                self.assertIn("projects.csv", names)
                self.assertIn("users.csv", names)
                projects_csv = zf.read("projects.csv").decode("utf-8")
                self.assertIn("Backed Up Project", projects_csv)
                users_csv = zf.read("users.csv").decode("utf-8")
                self.assertIn("backupauthor@example.com", users_csv)
        finally:
            if job.archive:
                job.archive.delete(save=False)


class RestoreJobTests(BackupJobTestCase):
    """CELERY_TASK_ALWAYS_EAGER=True in tests means .delay() below runs both
    the backup and restore tasks inline, synchronously."""

    def _seed_content(self, author):
        tag = Tag.objects.create(organization=self.organization, name="rocket")
        project = Project.objects.create(
            organization=self.organization,
            name="Falcon",
            description="A project",
            created_by=author,
        )
        project.tags.add(tag)
        article = Article.objects.create(
            organization=self.organization,
            title="Restorable Article",
            slug="restorable-article",
            content="Some content",
            author=author,
        )
        article.tags.add(tag)
        Bookmark.objects.create(
            organization=self.organization,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=article.id,
            user=author,
        )
        KnowledgeRelation.objects.create(
            organization=self.organization,
            source_content_type=ContentType.objects.get_for_model(Project),
            source_object_id=project.id,
            target_content_type=ContentType.objects.get_for_model(Article),
            target_object_id=article.id,
            relation_type="RELATED",
            created_by=author,
        )
        return project, article, tag

    def _run_backup(self, admin_access):
        response = self.client.post(reverse("backups-list-create"), **self._auth(admin_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        backup_job = BackupJob.objects.get(pk=response.data["id"])
        self.assertEqual(backup_job.status, BackupJob.Status.DONE)
        return backup_job

    def test_restore_round_trips_ids_content_tags_relations_and_bookmarks(self):
        author, _ = self._login_with_role("restoreauthor@example.com", "Subteam Head")
        admin, admin_access = self._login_with_role("restoreadmin@example.com", "Organization Admin")

        project, article, tag = self._seed_content(author)
        article.co_authors.add(admin)
        project_id, article_id, tag_id = project.id, article.id, tag.id

        backup_job = self._run_backup(admin_access)

        # Mutate/delete the originals so restore isn't a no-op check.
        Article.objects.filter(pk=article_id).update(title="Tampered")
        Project.objects.get(pk=project_id).delete()

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        restore_job_id = response.data["id"]

        response = self.client.get(reverse("backups-restore-detail", args=[restore_job_id]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE")
        self.assertEqual(str(response.data["source_backup_id"]), str(backup_job.id))
        self.assertEqual(response.data["summary"]["created"]["projects"], 1)
        self.assertEqual(response.data["summary"]["created"]["articles"], 1)
        self.assertEqual(response.data["summary"]["orphaned_user_refs"], 0)

        restored_project = Project.objects.get(pk=project_id)
        self.assertEqual(restored_project.name, "Falcon")
        self.assertEqual(restored_project.created_by_id, author.id)
        self.assertEqual(list(restored_project.tags.values_list("id", flat=True)), [tag_id])

        restored_article = Article.objects.get(pk=article_id)
        self.assertEqual(restored_article.title, "Restorable Article")
        self.assertEqual(restored_article.author_id, author.id)
        self.assertEqual(list(restored_article.co_authors.values_list("id", flat=True)), [admin.id])

        self.assertTrue(Bookmark.objects.filter(object_id=article_id, user=author).exists())
        self.assertTrue(
            KnowledgeRelation.objects.filter(source_object_id=project_id, target_object_id=article_id).exists()
        )

    def test_restore_round_trips_training_content_enrollment_and_progress(self):
        author, _ = self._login_with_role("courseauthor@example.com", "Subteam Head")
        learner, _ = self._login_with_role("courselearner@example.com", "Member")
        _, admin_access = self._login_with_role("courseadmin@example.com", "Organization Admin")

        _, article, _ = self._seed_content(author)

        category = CourseCategory.objects.create(organization=self.organization, name="Avionics", slug="avionics")
        course = Course.objects.create(
            organization=self.organization,
            title="Intro to Avionics",
            slug="intro-to-avionics",
            category=category,
            status="PUBLISHED",
            visibility="RESTRICTED",
            author=author,
        )
        # Course grants live in knowledge's RestrictedAccessGrant table but
        # point at a training model - restore has to resolve that content
        # type in the right app.
        RestrictedAccessGrant.objects.create(
            organization=self.organization,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=course.id,
            granted_user=learner,
            granted_by=author,
        )
        module = CourseModule.objects.create(course=course, title="Basics", order=1)
        lesson = Lesson.objects.create(module=module, title="Wiring", order=1)
        LearningObjective.objects.create(lesson=lesson, text="Identify wire gauges", order=1)
        CourseResource.objects.create(
            lesson=lesson,
            title="Reference sheet",
            resource_type=CourseResource.ResourceType.EXTERNAL_LINK,
            provider=CourseResource.Provider.WEBSITE,
            url="https://example.com/wiring",
            created_by=author,
        )
        LessonKnowledgeReference.objects.create(
            lesson=lesson,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=article.id,
            created_by=author,
        )
        enrollment = CourseEnrollment.objects.create(course=course, user=learner, organization=self.organization)
        LessonProgress.objects.create(enrollment=enrollment, lesson=lesson)

        course_id, module_id, lesson_id = course.id, module.id, lesson.id
        enrollment_id = enrollment.id

        backup_job = self._run_backup(admin_access)

        # Wipe the originals so restore isn't a no-op check.
        Course.objects.get(pk=course_id).delete()

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        restore_job_id = response.data["id"]

        response = self.client.get(reverse("backups-restore-detail", args=[restore_job_id]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE")
        self.assertEqual(response.data["summary"]["created"]["courses"], 1)
        self.assertEqual(response.data["summary"]["created"]["lessons"], 1)
        self.assertEqual(response.data["summary"]["created"]["course_enrollments"], 1)
        self.assertEqual(response.data["summary"]["created"]["lesson_progress"], 1)

        restored_course = Course.objects.get(pk=course_id)
        self.assertEqual(restored_course.title, "Intro to Avionics")
        self.assertEqual(restored_course.category_id, category.id)
        self.assertEqual(restored_course.author_id, author.id)
        self.assertEqual(restored_course.visibility, "RESTRICTED")
        self.assertTrue(
            RestrictedAccessGrant.objects.filter(
                content_type=ContentType.objects.get_for_model(Course), object_id=course_id, granted_user=learner
            ).exists()
        )

        restored_lesson = Lesson.objects.get(pk=lesson_id)
        self.assertEqual(restored_lesson.module_id, module_id)
        self.assertEqual(restored_lesson.objectives.count(), 1)
        self.assertEqual(restored_lesson.resources.count(), 1)

        restored_reference = LessonKnowledgeReference.objects.get(lesson_id=lesson_id)
        self.assertEqual(restored_reference.content_type, ContentType.objects.get_for_model(Article))
        self.assertEqual(restored_reference.object_id, article.id)

        restored_enrollment = CourseEnrollment.objects.get(pk=enrollment_id)
        self.assertEqual(restored_enrollment.user_id, learner.id)
        self.assertEqual(restored_enrollment.course_id, course_id)
        self.assertTrue(LessonProgress.objects.filter(enrollment_id=enrollment_id, lesson_id=lesson_id).exists())

    def _restore_from(self, admin_access, backup_job):
        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        response = self.client.get(reverse("backups-restore-detail", args=[response.data["id"]]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE", response.data)
        return response.data["summary"]

    def _backup_bytes(self, admin_access) -> bytes:
        backup_job = self._run_backup(admin_access)
        response = self.client.get(reverse("backups-download", args=[backup_job.id]), **self._auth(admin_access))
        return b"".join(response.streaming_content)

    def _upload(self, access, archive_bytes, name="athar-backup.zip"):
        return self.client.post(
            reverse("backups-restore-upload"),
            {"archive": SimpleUploadedFile(name, archive_bytes, content_type="application/zip")},
            format="multipart",
            **self._auth(access),
        )

    def _login(self, email, password="password123"):
        return self.client.post(reverse("auth-login"), {"email": email, "password": password}, format="json")

    def test_restore_brings_back_deleted_members_and_deactivates_newer_ones(self):
        author, _ = self._login_with_role("orphanauthor@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("orphanadmin@example.com", "Organization Admin")
        _, article, _ = self._seed_content(author)
        author_id = author.id
        original_created_at = Article.objects.get(pk=article.id).created_at

        backup_job = self._run_backup(admin_access)
        author.delete()
        newcomer, _ = self._login_with_role("newcomer@example.com", "Member")

        summary = self._restore_from(admin_access, backup_job)
        self.assertEqual(summary["deactivated_users"], 1)

        restored_author = User.objects.get(pk=author_id)
        self.assertTrue(restored_author.is_active)
        self.assertTrue(restored_author.has_permission("project.read"))
        self.assertEqual(Article.objects.get(pk=article.id).author_id, author_id)
        self.assertEqual(Article.objects.get(pk=article.id).created_at, original_created_at)
        # Same password hash as before the backup - logs in unchanged.
        self.assertEqual(self._login("orphanauthor@example.com").status_code, status.HTTP_200_OK)

        newcomer.refresh_from_db()
        self.assertFalse(newcomer.is_active)
        self.assertTrue(User.objects.get(email="orphanadmin@example.com").is_active)

    def test_restore_nulls_out_references_to_users_missing_from_the_archive(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr(
                "projects.csv",
                "id,name,description,status,visibility,tag_ids,tags,created_by_id,created_by_email,created_at,updated_at\n"
                "6a3b1b5e-1d2a-4c3e-9f00-0000000000bb,Ghost,,ACTIVE,PUBLIC,,,"
                "6a3b1b5e-1d2a-4c3e-9f00-0000000000cc,gone@example.com,,\n",
            )
        archive.seek(0)

        summary = restore.restore_org_backup_archive(self.organization, archive)

        self.assertEqual(summary.orphaned_user_refs, 1)
        self.assertIsNone(Project.objects.get(name="Ghost").created_by_id)

    def test_uploaded_archive_rebuilds_the_organization_on_a_fresh_server(self):
        author, _ = self._login_with_role("dr-author@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("dr-admin@example.com", "Organization Admin")
        project, article, tag = self._seed_content(author)
        archive_bytes = self._backup_bytes(admin_access)

        # "Lose the server": the original organization is gone entirely, and
        # a brand-new one is set up by an admin who isn't in the backup.
        fresh_org = create_test_organization()
        fresh_admin, fresh_access = self._login_with_role("fresh-admin@example.com", "Member", fresh_org)
        Role.objects.get(organization=fresh_org, name="Organization Admin").user_roles.create(user=fresh_admin)
        type(self.organization).objects.filter(pk=self.organization.pk).delete()

        response = self._upload(fresh_access, archive_bytes)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        job = RestoreJob.objects.get(pk=response.data["id"])
        self.assertEqual(job.status, RestoreJob.Status.DONE, job.error)
        self.assertFalse(job.uploaded_archive)  # discarded once used

        restored_author = User.objects.get(email="dr-author@example.com")
        self.assertEqual(restored_author.organization, fresh_org)
        self.assertTrue(restored_author.has_permission("project.read"))
        self.assertEqual(self._login("dr-author@example.com").status_code, status.HTTP_200_OK)
        self.assertEqual(Article.objects.get(pk=article.id).organization, fresh_org)
        self.assertEqual(list(Project.objects.get(pk=project.id).tags.values_list("id", flat=True)), [tag.id])
        # The admin who ran it keeps admin rights even though the backup's
        # roles were restored over theirs.
        fresh_admin.refresh_from_db()
        self.assertTrue(fresh_admin.is_active)
        self.assertTrue(fresh_admin.has_permission("organization.manage"))

    def test_upload_rejects_another_existing_organizations_backup(self):
        _, admin_access = self._login_with_role("xorg-admin@example.com", "Organization Admin")
        archive_bytes = self._backup_bytes(admin_access)
        other_org = create_test_organization()
        _, other_access = self._login_with_role("xorg-other@example.com", "Organization Admin", other_org)

        response = self._upload(other_access, archive_bytes)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(RestoreJob.objects.filter(organization=other_org).exists())

    def test_upload_rejects_a_non_backup_file(self):
        _, admin_access = self._login_with_role("junk-admin@example.com", "Organization Admin")
        response = self._upload(admin_access, b"not a zip", name="notes.zip")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_upload_requires_organization_manage(self):
        _, member_access = self._login_with_role("upload-member@example.com", "Member")
        response = self._upload(member_access, b"irrelevant")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_crafted_archive_cannot_reach_into_another_organization(self):
        other_org = create_test_organization()
        other_user = User.objects.create_user(email="victim@example.com", password="password123", organization=other_org)
        victim_question = Question.objects.create(organization=other_org, title="Private", body="...", author=other_user)

        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr(
                "answers.csv",
                "id,question_id,body,author_id,author_email,created_at\n"
                f"6a3b1b5e-1d2a-4c3e-9f00-0000000000dd,{victim_question.id},injected,,,\n",
            )
            zf.writestr(
                "knowledge_relations.csv",
                "id,source_type,source_object_id,target_type,target_object_id,relation_type,created_by_id,"
                "created_by_email,created_at\n"
                f"6a3b1b5e-1d2a-4c3e-9f00-0000000000ee,question,{victim_question.id},question,"
                f"{victim_question.id},RELATED,,,\n",
            )
        archive.seek(0)
        restore.restore_org_backup_archive(self.organization, archive)
        self.assertFalse(Answer.objects.filter(question=victim_question).exists())
        self.assertFalse(KnowledgeRelation.objects.filter(source_object_id=victim_question.id).exists())

        # Claiming another organization's member fails the whole restore.
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr(
                "users.csv",
                "id,email,username,first_name,last_name,title,is_active,password,date_joined\n"
                f"{other_user.id},victim@example.com,,,,,True,pbkdf2_sha256$x,\n",
            )
        archive.seek(0)
        with self.assertRaises(restore.RestoreError):
            restore.restore_org_backup_archive(self.organization, archive)
        other_user.refresh_from_db()
        self.assertEqual(other_user.organization, other_org)

    def test_restore_round_trips_component_inventory(self):
        author, _ = self._login_with_role("restoreinv@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("restoreinvadmin@example.com", "Organization Admin")
        drill = knowledge_services.create_component(
            actor=author,
            name="Cordless Drill",
            category=knowledge_services.get_or_create_component_category("Power Tools", actor=author),
            location_name="New Total Tools Box",
            inventory_type=Component.InventoryType.MECHANICAL,
            quantity_available=2,
            unit="each",
            condition=Component.Condition.NEW,
            min_quantity=1,
            inventory_notes="Includes 2x 20V batteries",
            link="https://example.com/drill",
            status="",
        )

        backup_job = self._run_backup(admin_access)
        Component.objects.filter(pk=drill.pk).delete()
        StorageLocation.objects.filter(organization=self.organization).delete()

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        response = self.client.get(reverse("backups-restore-detail", args=[response.data["id"]]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE", response.data)

        restored = Component.objects.get(pk=drill.pk)
        self.assertEqual(restored.category.name, "Power Tools")
        self.assertEqual(restored.location.name, "New Total Tools Box")
        self.assertEqual(restored.inventory_type, Component.InventoryType.MECHANICAL)
        self.assertEqual(restored.quantity_available, 2)
        self.assertEqual(restored.unit, "each")
        self.assertEqual(restored.condition, Component.Condition.NEW)
        self.assertEqual(restored.stock_status, Component.StockStatus.IN_STOCK)
        self.assertEqual(restored.min_quantity, 1)
        self.assertEqual(restored.inventory_notes, "Includes 2x 20V batteries")
        self.assertEqual(restored.link, "https://example.com/drill")
        self.assertEqual(restored.updated_by_id, author.id)

    def test_restore_round_trips_files_and_keeps_them_confirmed(self):
        author, _ = self._login_with_role("restorefiles@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("restorefilesadmin@example.com", "Organization Admin")
        stored_file = StoredFile.objects.create(
            organization=self.organization,
            file=SimpleUploadedFile("spec.pdf", b"pdf-bytes", content_type="application/pdf"),
            original_filename="spec.pdf",
            content_type="application/pdf",
            size=9,
            uploaded_by=author,
            confirmed_at=timezone.now(),
        )

        backup_job = self._run_backup(admin_access)
        # The file still exists at restore time - the common "roll back to
        # last week" case, not just a restore into an empty organization.
        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        response = self.client.get(reverse("backups-restore-detail", args=[response.data["id"]]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE", response.data)

        restored = StoredFile.objects.get(pk=stored_file.pk)
        with restored.file.open("rb") as f:
            self.assertEqual(f.read(), b"pdf-bytes")
        # Otherwise files.services.delete_unconfirmed_files would reclaim
        # every restored file 24h later.
        self.assertIsNotNone(restored.confirmed_at)

    def test_restore_keeps_a_questions_accepted_answer(self):
        author, _ = self._login_with_role("restoreqa@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("restoreqaadmin@example.com", "Organization Admin")
        question = Question.objects.create(organization=self.organization, title="Which servo?", body="...", author=author)
        answer = Answer.objects.create(question=question, body="The MG996R", author=author)
        Question.objects.filter(pk=question.pk).update(accepted_answer=answer)

        backup_job = self._run_backup(admin_access)
        with backup_job.archive.open("rb") as archive, zipfile.ZipFile(archive) as zf:
            self.assertIn("policy_acceptances.csv", zf.namelist())
        Question.objects.filter(pk=question.pk).update(accepted_answer=None)

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        response = self.client.get(reverse("backups-restore-detail", args=[response.data["id"]]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE", response.data)
        self.assertEqual(Question.objects.get(pk=question.pk).accepted_answer_id, answer.pk)

    def test_restoring_an_archive_from_before_component_categories_rebuilds_them_by_name(self):
        legacy_components_csv = (
            "id,name,category_id,category,manufacturer,part_number,status,summary,specifications,visibility,"
            "tag_ids,tags,created_by_id,created_by_email,created_at,updated_at\n"
            "6a3b1b5e-1d2a-4c3e-9f00-000000000001,Pixhawk,9d1f0000-0000-0000-0000-00000000abcd,Avionics,Holybro,"
            "PIX6X,CERTIFIED,,[],PUBLIC,,,,,2026-01-01,2026-01-01\n"
        )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("components.csv", legacy_components_csv)
        archive.seek(0)

        restore.restore_org_backup_archive(self.organization, archive)

        pixhawk = Component.objects.get(organization=self.organization, name="Pixhawk")
        self.assertEqual(pixhawk.category, ComponentCategory.objects.get(organization=self.organization, name="Avionics"))
        self.assertEqual(pixhawk.stock_status, "")  # untracked, as it was

    def test_only_organization_manage_can_list_or_create_restores(self):
        author, _ = self._login_with_role("restorepermauthor@example.com", "Subteam Head")
        _, member_access = self._login_with_role("restorepermmember@example.com", "Member")
        _, admin_access = self._login_with_role("restorepermadmin@example.com", "Organization Admin")

        self._seed_content(author)
        backup_job = self._run_backup(admin_access)

        response = self.client.get(reverse("backups-restore-list-create"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        response = self.client.get(
            reverse("backups-restore-detail", args=[response.data["id"]]), **self._auth(member_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class RestoreJobCrossOrgIsolationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org_a = create_test_organization(name="Restore Org A")
        cls.org_b = create_test_organization(name="Restore Org B")

    def _login_with_role(self, email, role_name, organization):
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_admin_cannot_restore_using_another_orgs_backup_job(self):
        _, a_admin_access = self._login_with_role("a-restoreadmin@example.com", "Organization Admin", self.org_a)
        _, b_admin_access = self._login_with_role("b-restoreadmin@example.com", "Organization Admin", self.org_b)

        response = self.client.post(reverse("backups-list-create"), **self._auth(a_admin_access))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        a_backup_job = BackupJob.objects.get(pk=response.data["id"])

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(a_backup_job.id)},
            format="json",
            **self._auth(b_admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(RestoreJob.objects.filter(organization=self.org_b).exists())

        if a_backup_job.archive:
            a_backup_job.archive.delete(save=False)
