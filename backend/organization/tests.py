from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from core.testing import create_test_organization
from accounts.models import User
from files.models import StoredFile
from rbac.models import Role

from .models import Organization, OrganizationSettings

# Smallest thing organization.services.branding_image_content_type accepts
# as a PNG - just the signature plus a few bytes; nothing decodes it.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake-png-body"


class OrganizationSettingsTests(APITestCase):
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

    def test_settings_load_is_idempotent_per_organization(self):
        first = OrganizationSettings.load(self.organization)
        second = OrganizationSettings.load(self.organization)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(OrganizationSettings.objects.filter(organization=self.organization).count(), 1)

    def test_any_authenticated_user_can_read_settings(self):
        access = self._login_with_role("member@example.com", "Member")
        response = self.client.get(reverse("organization-settings"), **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Athar")

    def test_settings_read_is_public_no_auth_required(self):
        # Needed pre-login too - the login screen shows the org name/branding.
        response = self.client.get(reverse("organization-settings"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Athar")

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
        self.assertEqual(OrganizationSettings.load(self.organization).name, "New Name")

    def test_product_tour_enabled_defaults_on_and_is_toggleable_by_an_admin(self):
        self.assertTrue(OrganizationSettings.load(self.organization).product_tour_enabled)

        admin_access = self._login_with_role("touradmin@example.com", "Organization Admin")
        response = self.client.patch(
            reverse("organization-general-update"),
            {"product_tour_enabled": False},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["product_tour_enabled"])
        self.assertFalse(OrganizationSettings.load(self.organization).product_tour_enabled)

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
        self.assertEqual(OrganizationSettings.load(self.organization).primary_color, "#ff0000")

    def test_logo_endpoint_is_public_and_streams_the_image(self):
        # _public_organization()'s anonymous fallback prefers the oldest
        # Organization that has a user (see its own docstring) - a bootstrap
        # Organization already exists from a data migration by the time any
        # test runs, with no user in it yet, so once we create one there it
        # becomes "the oldest org with a user" and is what an anonymous
        # request actually sees - not self.organization, which also has no
        # user at this point. This test exercises that real, documented
        # behavior explicitly rather than assuming the anonymous fallback is
        # "your own org."
        public_organization = Organization.objects.order_by("created_at").first()

        # No logo set yet - 404.
        self.assertEqual(self.client.get(reverse("organization-logo")).status_code, status.HTTP_404_NOT_FOUND)

        admin = User.objects.create_user(
            email="logoadmin@example.com", password="password123", organization=public_organization
        )
        Role.objects.get(organization=public_organization, name="Organization Admin").user_roles.create(user=admin)
        admin_access = self.client.post(
            reverse("auth-login"), {"email": "logoadmin@example.com", "password": "password123"}, format="json"
        ).data["access"]

        logo_file = StoredFile.objects.create(
            organization=public_organization,
            file=SimpleUploadedFile("logo.png", PNG_BYTES, content_type="image/png"),
            original_filename="logo.png",
            content_type="image/png",
            size=len(PNG_BYTES),
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
        self.assertEqual(b"".join(logo_response.streaming_content), PNG_BYTES)
        # Type comes from the bytes, and the sandbox CSP keeps even a
        # mislabelled file from running script on this origin.
        self.assertEqual(logo_response["Content-Type"], "image/png")
        self.assertIn("sandbox", logo_response["Content-Security-Policy"])

    def test_branding_rejects_non_raster_images(self):
        # An SVG logo/favicon would be served inline from the app's own
        # origin on a public URL - stored XSS for anyone who opens it. The
        # check sniffs content, so neither the filename nor the claimed
        # MIME type can talk it past.
        admin = User.objects.create_user(
            email="svgadmin@example.com", password="correctpassword123", organization=self.organization
        )
        Role.objects.get(organization=self.organization, name="Organization Admin").user_roles.create(user=admin)
        access = self.client.post(
            reverse("auth-login"), {"email": "svgadmin@example.com", "password": "correctpassword123"}, format="json"
        ).data["access"]
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        for field in ("logo_id", "favicon_id"):
            disguised = StoredFile.objects.create(
                organization=self.organization,
                file=SimpleUploadedFile("logo.png", svg, content_type="image/png"),
                original_filename="logo.png",
                content_type="image/png",
                size=len(svg),
            )
            response = self.client.patch(
                reverse("organization-branding-update"), {field: str(disguised.pk)}, format="json", **self._auth(access)
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, field)
            self.assertIn(field, response.data)

    def test_public_endpoints_prefer_a_populated_org_over_an_empty_older_one(self):
        # Regression test for a real deployment bug: a single-org self-hosted
        # install's bootstrap Organization (oldest by construction, see
        # organization/migrations/0002_seed_bootstrap_organization.py) never
        # gets a user if the operator instead registers via self-service org
        # creation - plain oldest-first then permanently serves the empty
        # bootstrap org's blank branding to every anonymous/pre-login
        # request, never the operator's actual (younger, but populated) org.
        bootstrap_organization = Organization.objects.order_by("created_at").first()
        self.assertEqual(
            User.objects.filter(organization=bootstrap_organization).count(),
            0,
            "bootstrap org must still be unused for this test to be meaningful",
        )

        admin = User.objects.create_user(
            email="realadmin@example.com", password="password123", organization=self.organization
        )
        Role.objects.get(organization=self.organization, name="Organization Admin").user_roles.create(user=admin)
        response = self.client.patch(
            reverse("organization-general-update"),
            {"name": "Real Org"},
            format="json",
            **self._auth(
                self.client.post(
                    reverse("auth-login"),
                    {"email": "realadmin@example.com", "password": "password123"},
                    format="json",
                ).data["access"]
            ),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Anonymous - must resolve to self.organization (has a user), not the
        # older-but-empty bootstrap org.
        public_response = self.client.get(reverse("organization-settings"))
        self.assertEqual(public_response.status_code, status.HTTP_200_OK)
        self.assertEqual(public_response.data["name"], "Real Org")


@override_settings(ENABLE_ORGANIZATION_REGISTRATION=True)
class OrganizationCreateTests(APITestCase):
    """The self-service SaaS signup entrypoint - POST /api/v1/organization/,
    AllowAny. See services.create_organization's own docstring for how this
    differs from accounts.RegisterView (joins an existing org via invite).

    Pins ENABLE_ORGANIZATION_REGISTRATION=True at the class level rather than
    relying on its default - these tests assert what happens when org signup
    is enabled, so they shouldn't silently break in an environment (or CI
    config) that happens to have it turned off. test_organization_
    registration_disabled_returns_404 below overrides it back to False just
    for itself."""

    def test_creates_organization_with_first_admin(self):
        response = self.client.post(
            reverse("organization-create"),
            {"name": "Brand New Org", "admin_email": "founder@neworg.example", "admin_password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["roles"], ["Organization Admin"])

        user = User.objects.get(email="founder@neworg.example")
        self.assertEqual(user.organization.name, "Brand New Org")
        # Doesn't auto-login the caller (see the view's own docstring) - the
        # response is the created admin, not a token pair.
        self.assertNotIn("access", response.data)

    def test_organization_registration_disabled_returns_404(self):
        with self.settings(ENABLE_ORGANIZATION_REGISTRATION=False):
            response = self.client.post(
                reverse("organization-create"),
                {"name": "Blocked Org", "admin_email": "blocked@neworg.example", "admin_password": "somepassword123"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Organization.objects.filter(name="Blocked Org").exists())

    def test_admin_email_rejects_duplicates_with_a_clean_400(self):
        User.objects.create_user(
            email="already-registered@example.com",
            password="somepassword123",
            organization=create_test_organization(),
        )

        response = self.client.post(
            reverse("organization-create"),
            {
                "name": "Second Org",
                "admin_email": "already-registered@example.com",
                "admin_password": "somepassword123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_email", response.data)
        self.assertFalse(Organization.objects.filter(name="Second Org").exists())

    # Same pattern as accounts/tests.py's test_login_is_rate_limited_after_repeated_attempts -
    # see that test's own comment for why THROTTLE_RATES has to be patched
    # directly rather than via override_settings.
    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/min"})
    def test_organization_create_is_rate_limited_after_repeated_attempts(self):
        cache.clear()
        for i in range(3):
            response = self.client.post(
                reverse("organization-create"),
                {"name": f"Org {i}", "admin_email": f"founder{i}@neworg.example", "admin_password": "somepassword123"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        response = self.client.post(
            reverse("organization-create"),
            {"name": "One Too Many", "admin_email": "onetoomany@neworg.example", "admin_password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertFalse(Organization.objects.filter(name="One Too Many").exists())
        self.assertFalse(User.objects.filter(email="blocked@neworg.example").exists())

    def test_admin_username_accepted_and_rejects_duplicates(self):
        self.client.post(
            reverse("organization-create"),
            {
                "name": "First Org",
                "admin_email": "first@neworg.example",
                "admin_password": "somepassword123",
                "admin_username": "founder",
            },
            format="json",
        )

        response = self.client.post(
            reverse("organization-create"),
            {
                "name": "Second Org",
                "admin_email": "second@neworg.example",
                "admin_password": "somepassword123",
                "admin_username": "founder",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_username", response.data)
        self.assertFalse(User.objects.filter(email="second@neworg.example").exists())
        self.assertFalse(Organization.objects.filter(name="Second Org").exists())

    def test_admin_username_is_optional(self):
        response = self.client.post(
            reverse("organization-create"),
            {"name": "No Username Org", "admin_email": "nouser@neworg.example", "admin_password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(User.objects.get(email="nouser@neworg.example").username)

    def test_rejects_a_case_variant_of_an_existing_email(self):
        other = create_test_organization()
        User.objects.create_user(email="taken@example.com", password="correctpassword123", organization=other)
        response = self.client.post(
            reverse("organization-create"),
            {"name": "Squatter Org", "admin_email": "TAKEN@example.com", "admin_password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_email", response.data)
        self.assertFalse(Organization.objects.filter(name="Squatter Org").exists())

    def test_rejects_weak_admin_password(self):
        response = self.client.post(
            reverse("organization-create"),
            {"name": "Weak Org", "admin_email": "weak@neworg.example", "admin_password": "12345678"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("admin_password", response.data)
