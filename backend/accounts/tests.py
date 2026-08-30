from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

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

    def test_me_patch_updates_own_profile_but_not_email_or_roles(self):
        response = self.client.patch(reverse("auth-me"), {"title": "Nope"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        login_response = self._register_and_login("profile@example.com", "profilepass123")
        access = login_response.data["access"]
        response = self.client.patch(
            reverse("auth-me"),
            {"first_name": "Ada", "last_name": "Lovelace", "title": "Lead Systems Integration", "email": "hacked@example.com"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["first_name"], "Ada")
        self.assertEqual(response.data["last_name"], "Lovelace")
        self.assertEqual(response.data["title"], "Lead Systems Integration")
        # email is not in MeUpdateSerializer's fields - silently ignored, not an error.
        self.assertEqual(response.data["email"], "profile@example.com")
        self.assertEqual(response.data["roles"], ["Guest"])

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

    # Throttling is switched off for the rest of this file (see
    # config/settings.py's `if "test" in sys.argv`) since _register_and_login
    # is called dozens of times across this suite - this test explicitly
    # re-enables a tight "auth" rate for itself to prove the throttle actually
    # engages, not just that it's configured. ScopedRateThrottle.THROTTLE_RATES
    # is bound to api_settings.DEFAULT_THROTTLE_RATES once, at import time -
    # @override_settings doesn't reach it, so the dict itself has to be patched.
    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/min"})
    def test_login_is_rate_limited_after_repeated_attempts(self):
        cache.clear()
        User.objects.create_user(email="throttled@example.com", password="correctpassword123")

        for _ in range(3):
            response = self.client.post(
                reverse("auth-login"),
                {"email": "throttled@example.com", "password": "wrongpassword"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        response = self.client.post(
            reverse("auth-login"),
            {"email": "throttled@example.com", "password": "wrongpassword"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        # A correct password doesn't bypass the throttle either - it's keyed
        # on the client, not on whether the attempt would have succeeded.
        response = self.client.post(
            reverse("auth-login"),
            {"email": "throttled@example.com", "password": "correctpassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
