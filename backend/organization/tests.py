from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from files.models import StoredFile
from rbac.models import Role

from .models import OrganizationSettings


class OrganizationSettingsTests(APITestCase):
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

    def test_settings_is_a_singleton(self):
        first = OrganizationSettings.load()
        second = OrganizationSettings.load()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(OrganizationSettings.objects.count(), 1)

    def test_any_authenticated_user_can_read_settings(self):
        access = self._login_with_role("member@example.com", "Member")
        response = self.client.get(reverse("organization-settings"), **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "AeroKMS")

    def test_settings_read_is_public_no_auth_required(self):
        # Needed pre-login too - the login screen shows the org name/branding.
        response = self.client.get(reverse("organization-settings"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "AeroKMS")

    def test_settings_response_has_no_timezone_field(self):
        response = self.client.get(reverse("organization-settings"))
        self.assertNotIn("timezone", response.data)

    def test_general_update_requires_organization_manage(self):
        access = self._login_with_role("member2@example.com", "Member")
        response = self.client.patch(
            reverse("organization-general-update"),
            {"name": "New Name"},
            format="json",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        admin_access = self._login_with_role("admin@example.com", "Organization Admin")
        response = self.client.patch(
            reverse("organization-general-update"),
            {"name": "New Name"},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(OrganizationSettings.load().name, "New Name")

    def test_branding_update_requires_branding_manage(self):
        access = self._login_with_role("member3@example.com", "Member")
        response = self.client.patch(
            reverse("organization-branding-update"),
            {"primary_color": "#ff0000"},
            format="json",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        admin_access = self._login_with_role("admin2@example.com", "Organization Admin")
        response = self.client.patch(
            reverse("organization-branding-update"),
            {"primary_color": "#ff0000"},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(OrganizationSettings.load().primary_color, "#ff0000")

    def test_logo_endpoint_is_public_and_streams_the_image(self):
        # No logo set yet - 404.
        self.assertEqual(self.client.get(reverse("organization-logo")).status_code, status.HTTP_404_NOT_FOUND)

        admin_access = self._login_with_role("logoadmin@example.com", "Organization Admin")
        logo_file = StoredFile.objects.create(
            file=SimpleUploadedFile("logo.png", b"fake-png-bytes", content_type="image/png"),
            original_filename="logo.png",
            content_type="image/png",
            size=14,
        )
        response = self.client.patch(
            reverse("organization-branding-update"),
            {"logo_id": str(logo_file.pk)},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["logo_url"], "/api/v1/organization/settings/logo/")

        # No auth header at all - this must work, unlike files/views.py's
        # authenticated download endpoint, since the login screen needs it.
        logo_response = self.client.get(reverse("organization-logo"))
        self.assertEqual(logo_response.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(logo_response.streaming_content), b"fake-png-bytes")
