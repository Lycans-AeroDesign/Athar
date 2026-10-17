import io
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.db.utils import OperationalError
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core import crypto
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

    @patch.dict(os.environ, {"BACKUP_PASSPHRASE": "full backup passphrase"})
    def test_restore_full_backup_recreates_a_deleted_project(self):
        organization = create_test_organization()
        project = Project.objects.create(organization=organization, name="Full-Backup Project")
        project_id = project.id

        with tempfile.TemporaryDirectory() as tmp_dir:
            call_command("create_full_backup", "--output-dir", tmp_dir)
            dump_path = next(Path(tmp_dir).glob("athar-db-*.dump.enc"))
            with open(dump_path, "rb") as dump_file:
                self.assertTrue(crypto.needs_passphrase(dump_file))

            Project.objects.filter(pk=project_id).delete()
            self.assertFalse(Project.objects.filter(pk=project_id).exists())

            with patch.dict(os.environ, {"BACKUP_PASSPHRASE": "the wrong passphrase"}):
                with self.assertRaises(CommandError):
                    call_command("restore_full_backup", str(dump_path), "--yes")
            call_command("restore_full_backup", str(dump_path), "--yes")

        self.assertTrue(Project.objects.filter(pk=project_id, name="Full-Backup Project").exists())

    def test_restore_full_backup_requires_yes(self):
        with tempfile.NamedTemporaryFile(suffix=".dump") as dump_file:
            with self.assertRaises(CommandError):
                call_command("restore_full_backup", dump_file.name)


class CryptoStreamTests(SimpleTestCase):
    PASSPHRASE = "a long enough passphrase"

    def _encrypt(self, data, passphrase=PASSPHRASE):
        return b"".join(crypto.iter_encrypt([data], passphrase))

    def _decrypt(self, data, passphrase=PASSPHRASE):
        return b"".join(crypto.iter_decrypt(io.BytesIO(data), passphrase))

    def test_round_trips_across_chunk_boundaries(self):
        for size in (0, 1, crypto.CHUNK_SIZE - 1, crypto.CHUNK_SIZE, crypto.CHUNK_SIZE + 1, 3 * crypto.CHUNK_SIZE):
            data = os.urandom(size)
            self.assertEqual(self._decrypt(self._encrypt(data)), data)
            self.assertEqual(len(self._encrypt(data)), crypto.encrypted_size(size))
            self.assertEqual(self._decrypt(self._encrypt(data, None), None), data)

    def test_rejects_wrong_passphrase_and_tampering(self):
        data = os.urandom(3 * crypto.CHUNK_SIZE)
        encrypted = self._encrypt(data)
        sealed = crypto.CHUNK_SIZE + crypto.TAG_SIZE
        body = encrypted[crypto.HEADER_SIZE:]
        chunks = [body[i:i + sealed] for i in range(0, len(body), sealed)]
        header = bytearray(encrypted[:crypto.HEADER_SIZE])
        header[-1] ^= 0x01
        flipped = bytearray(encrypted)
        flipped[crypto.HEADER_SIZE + 10] ^= 0x01
        variants = {
            "wrong passphrase": (encrypted, "not the passphrase"),
            "flipped byte": (bytes(flipped), self.PASSPHRASE),
            "truncated mid-chunk": (encrypted[:-100], self.PASSPHRASE),
            "last chunk dropped": (encrypted[:crypto.HEADER_SIZE] + b"".join(chunks[:-1]), self.PASSPHRASE),
            "chunks reordered": (encrypted[:crypto.HEADER_SIZE] + chunks[1] + chunks[0] + b"".join(chunks[2:]), self.PASSPHRASE),
            "header edited": (bytes(header) + body, self.PASSPHRASE),
            "no passphrase": (encrypted, None),
        }
        for name, (variant, passphrase) in variants.items():
            with self.subTest(name), self.assertRaises(crypto.DecryptionError):
                self._decrypt(variant, passphrase)

    def test_verify_passphrase_checks_only_the_first_chunk_and_keeps_position(self):
        source = io.BytesIO(self._encrypt(os.urandom(2 * crypto.CHUNK_SIZE)))
        crypto.verify_passphrase(source, self.PASSPHRASE)
        self.assertEqual(source.tell(), 0)
        with self.assertRaises(crypto.DecryptionError):
            crypto.verify_passphrase(source, "not the passphrase")

    def test_rejects_out_of_range_scrypt_parameters_from_the_header(self):
        encrypted = bytearray(self._encrypt(b"data"))
        # log2(n) byte - 30 would ask scrypt for 128GB before any tag check.
        for log2_n in (0, 30):
            encrypted[26] = log2_n
            with self.subTest(log2_n=log2_n), self.assertRaises(crypto.DecryptionError):
                self._decrypt(bytes(encrypted))

    def test_server_key_encryption_doesnt_decrypt_under_another_server_key(self):
        encrypted = self._encrypt(b"stored archive", None)
        with override_settings(BACKUP_ENCRYPTION_KEY="QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="):
            with self.assertRaises(crypto.DecryptionError):
                self._decrypt(encrypted, None)
