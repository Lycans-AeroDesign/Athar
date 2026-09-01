from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from rbac.models import Role

from .models import StoredFile


class FileServingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_rbac")

    def _login_with_role(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123")
        Role.objects.get(name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_upload_download_delete_lifecycle(self):
        access = self._login_with_role("uploader@example.com", "Member")
        upload = SimpleUploadedFile("note.txt", b"hello world", content_type="text/plain")

        response = self.client.post(
            reverse("files-upload"),
            {"file": upload, "required_permission": "file.read"},
            format="multipart",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        file_id = response.data["id"]

        download = self.client.get(reverse("files-download", args=[file_id]), **self._auth(access))
        self.assertEqual(download.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(download.streaming_content), b"hello world")

        anonymous_download = self.client.get(reverse("files-download", args=[file_id]))
        self.assertEqual(anonymous_download.status_code, status.HTTP_401_UNAUTHORIZED)

        # file.delete is Organization-Admin-only by default (no ownership override) -
        # the uploader's own Member role can't delete it themselves.
        member_delete_attempt = self.client.delete(
            reverse("files-delete", args=[file_id]), **self._auth(access)
        )
        self.assertEqual(member_delete_attempt.status_code, status.HTTP_403_FORBIDDEN)

        admin_access = self._login_with_role("fileadmin@example.com", "Organization Admin")
        delete = self.client.delete(reverse("files-delete", args=[file_id]), **self._auth(admin_access))
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(StoredFile.objects.filter(pk=file_id).exists())

        missing = self.client.get(reverse("files-download", args=[file_id]), **self._auth(admin_access))
        self.assertEqual(missing.status_code, status.HTTP_404_NOT_FOUND)

    def test_download_forbidden_without_required_permission(self):
        uploader_access = self._login_with_role("uploader2@example.com", "Member")
        upload = SimpleUploadedFile("secret.txt", b"top secret", content_type="text/plain")
        upload_response = self.client.post(
            reverse("files-upload"),
            {"file": upload, "required_permission": "file.read"},
            format="multipart",
            **self._auth(uploader_access),
        )
        file_id = upload_response.data["id"]

        # Guest only has article.read - not file.read.
        guest_access = self._login_with_role("guest3@example.com", "Guest")
        response = self.client.get(reverse("files-download", args=[file_id]), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_upload_rejects_file_over_the_configured_size_limit(self):
        from django.test import override_settings

        access = self._login_with_role("uploader3@example.com", "Member")
        oversized = SimpleUploadedFile(
            "big.bin", b"x" * (3 * 1024 * 1024), content_type="application/octet-stream"
        )

        with override_settings(MAX_UPLOAD_SIZE_MB=2):
            response = self.client.post(
                reverse("files-upload"),
                {"file": oversized, "required_permission": "file.read"},
                format="multipart",
                **self._auth(access),
            )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_upload_rejects_unknown_required_permission_codename(self):
        access = self._login_with_role("uploader4@example.com", "Member")
        upload = SimpleUploadedFile("note.txt", b"hello", content_type="text/plain")
        response = self.client.post(
            reverse("files-upload"),
            {"file": upload, "required_permission": "not.a.real.codename"},
            format="multipart",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
