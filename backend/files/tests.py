from django.core.files.uploadedfile import SimpleUploadedFile

from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User
from rbac.models import Role

from .models import StoredFile
from .validation import validate_upload


class FileServingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login_with_role(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name=role_name).user_roles.create(user=user)
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


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class UploadValidationTests(SimpleTestCase):
    def _upload(self, name, content, content_type="application/octet-stream"):
        return SimpleUploadedFile(name, content, content_type=content_type)

    def test_valid_png_returns_the_canonical_content_type(self):
        self.assertEqual(validate_upload(self._upload("photo.PNG", PNG_BYTES)), "image/png")

    def test_content_must_match_the_extension(self):
        with self.assertRaisesMessage(ValidationError, "don't match"):
            validate_upload(self._upload("photo.png", b"<html><script>alert(1)</script></html>"))

    def test_pdf_and_office_files_are_checked_by_signature(self):
        self.assertEqual(validate_upload(self._upload("spec.pdf", b"%PDF-1.7\n...")), "application/pdf")
        with self.assertRaises(ValidationError):
            validate_upload(self._upload("spec.pdf", b"not a pdf"))
        validate_upload(self._upload("sheet.xlsx", b"PK\x03\x04rest"))

    def test_text_formats_must_not_contain_binary_bytes(self):
        validate_upload(self._upload("notes.csv", b"a,b\n1,2\n"))
        with self.assertRaises(ValidationError):
            validate_upload(self._upload("notes.csv", b"a,b\x00\x01"))

    def test_active_content_is_always_blocked(self):
        for name in ("page.html", "image.svg", "run.js", "tool.exe", "x.bat", "shell.php"):
            with self.subTest(name=name), self.assertRaisesMessage(ValidationError, "can't be uploaded"):
                validate_upload(self._upload(name, b"x"))

    def test_blocked_types_cannot_be_unlocked_through_the_extra_extensions_setting(self):
        with override_settings(UPLOAD_EXTRA_EXTENSIONS=["html", "svg"]):
            with self.assertRaises(ValidationError):
                validate_upload(self._upload("page.html", b"<html>"))

    def test_unknown_and_missing_extensions_are_rejected(self):
        for name in ("archive.weird", "README"):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                validate_upload(self._upload(name, b"data"))

    def test_extra_extensions_setting_allows_additional_types(self):
        with override_settings(UPLOAD_EXTRA_EXTENSIONS=["foo"]):
            self.assertEqual(validate_upload(self._upload("part.foo", b"data")), "application/octet-stream")

    def test_double_extension_is_judged_by_the_final_one(self):
        with self.assertRaises(ValidationError):
            validate_upload(self._upload("report.pdf.html", b"%PDF-1.7"))


class UploadEndpointValidationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _upload(self, upload):
        user = User.objects.create_user(email="up@example.com", password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name="Member").user_roles.create(user=user)
        access = self.client.post(
            reverse("auth-login"), {"email": "up@example.com", "password": "password123"}, format="json"
        ).data["access"]
        return self.client.post(
            reverse("files-upload"), {"file": upload}, format="multipart", HTTP_AUTHORIZATION=f"Bearer {access}"
        )

    def test_client_supplied_content_type_is_ignored(self):
        response = self._upload(SimpleUploadedFile("diagram.png", PNG_BYTES, content_type="text/html"))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["content_type"], "image/png")

    def test_html_disguised_as_an_image_is_rejected(self):
        response = self._upload(SimpleUploadedFile("diagram.png", b"<html></html>", content_type="image/png"))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(StoredFile.objects.count(), 0)
