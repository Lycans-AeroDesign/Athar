import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.db.utils import OperationalError
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from knowledge.models import Project


class HealthCheckTests(APITestCase):
    def test_health_check_is_public_and_reports_ok(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ok")

    @patch("core.views.connection.ensure_connection")
    def test_health_check_reports_unhealthy_when_db_is_unreachable(self, mock_ensure_connection):
        mock_ensure_connection.side_effect = OperationalError("could not connect")
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.data["status"], "unhealthy")


class FullInstanceBackupRestoreTests(TransactionTestCase):
    """create_full_backup/restore_full_backup shell out to pg_dump/pg_restore
    as separate OS processes, so this needs TransactionTestCase (which
    commits real rows) rather than TestCase (whose outer transaction a
    separate process's connection could never see)."""

    def test_restore_full_backup_recreates_a_deleted_project(self):
        organization = create_test_organization()
        project = Project.objects.create(organization=organization, name="Full-Backup Project")
        project_id = project.id

        with tempfile.TemporaryDirectory() as tmp_dir:
            call_command("create_full_backup", "--output-dir", tmp_dir)
            dump_path = next(Path(tmp_dir).glob("athar-db-*.dump"))
            self.assertTrue(dump_path.exists())

            Project.objects.filter(pk=project_id).delete()
            self.assertFalse(Project.objects.filter(pk=project_id).exists())

            call_command("restore_full_backup", str(dump_path), "--yes")

        self.assertTrue(Project.objects.filter(pk=project_id, name="Full-Backup Project").exists())

    def test_restore_full_backup_requires_yes(self):
        with tempfile.NamedTemporaryFile(suffix=".dump") as dump_file:
            with self.assertRaises(CommandError):
                call_command("restore_full_backup", dump_file.name)
