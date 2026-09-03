import io
import zipfile

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User
from rbac.models import Role

from knowledge.models import Article, Bookmark, KnowledgeRelation, Project, Tag

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
        _, admin_access = self._login_with_role("restoreadmin@example.com", "Organization Admin")

        project, article, tag = self._seed_content(author)
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

        self.assertTrue(Bookmark.objects.filter(object_id=article_id, user=author).exists())
        self.assertTrue(
            KnowledgeRelation.objects.filter(source_object_id=project_id, target_object_id=article_id).exists()
        )

    def test_restore_nulls_out_references_to_deleted_users(self):
        author, _ = self._login_with_role("orphanauthor@example.com", "Subteam Head")
        _, admin_access = self._login_with_role("orphanadmin@example.com", "Organization Admin")

        _, article, _ = self._seed_content(author)

        backup_job = self._run_backup(admin_access)
        author.delete()

        response = self.client.post(
            reverse("backups-restore-list-create"),
            {"backup_job_id": str(backup_job.id)},
            format="json",
            **self._auth(admin_access),
        )
        restore_job_id = response.data["id"]

        response = self.client.get(reverse("backups-restore-detail", args=[restore_job_id]), **self._auth(admin_access))
        self.assertEqual(response.data["status"], "DONE")
        self.assertGreaterEqual(response.data["summary"]["orphaned_user_refs"], 1)

        restored_article = Article.objects.get(pk=article.id)
        self.assertIsNone(restored_article.author_id)

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
