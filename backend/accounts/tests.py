from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import User


class AuthFlowTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_rbac")

    def _register_and_login(self, email="guest@example.com", password="guestpass123"):
        self.client.post(
            reverse("auth-register"), {"email": email, "password": password}, format="json"
        )
        return self.client.post(
            reverse("auth-login"), {"email": email, "password": password}, format="json"
        )

    def test_register_assigns_guest_role(self):
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["roles"], ["Guest"])
        self.assertIn("article.read", response.data["permissions"])

    def test_login_sets_httponly_refresh_cookie_and_omits_it_from_body(self):
        response = self._register_and_login()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("refresh", response.data)
        self.assertIn("access", response.data)

        cookie = response.cookies["refresh_token"]
        self.assertTrue(cookie["httponly"])

    def test_me_requires_authentication(self):
        response = self.client.get(reverse("auth-me"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        login_response = self._register_and_login()
        access = login_response.data["access"]
        response = self.client.get(reverse("auth-me"), HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "guest@example.com")

    def test_refresh_uses_cookie_and_rotates_it(self):
        login_response = self._register_and_login()
        old_cookie_value = login_response.cookies["refresh_token"].value

        refresh_response = self.client.post(reverse("auth-refresh"))
        self.assertEqual(refresh_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", refresh_response.data)
        self.assertNotIn("refresh", refresh_response.data)
        self.assertNotEqual(refresh_response.cookies["refresh_token"].value, old_cookie_value)

    def test_refresh_without_cookie_is_unauthorized(self):
        response = self.client.post(reverse("auth-refresh"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_blacklists_refresh_token(self):
        login_response = self._register_and_login()
        refresh_cookie = login_response.cookies["refresh_token"].value

        logout_response = self.client.post(reverse("auth-logout"))
        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)

        # Replay the pre-logout refresh token directly - it must now be rejected.
        self.client.cookies["refresh_token"] = refresh_cookie
        replay_response = self.client.post(reverse("auth-refresh"))
        self.assertEqual(replay_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_registration_disabled_returns_404(self):
        with self.settings(ENABLE_REGISTRATION=False):
            response = self.client.post(
                reverse("auth-register"),
                {"email": "blocked@example.com", "password": "somepassword123"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(User.objects.filter(email="blocked@example.com").exists())
