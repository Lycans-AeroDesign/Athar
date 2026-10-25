import datetime
import json
import threading
from unittest.mock import patch

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core import mail
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from audit.models import AuditLog
from core.testing import RoleLoginMixin, create_test_organization
from files.models import StoredFile
from knowledge.models import Article, Bookmark
from rbac.models import Permission, Role

from .models import InvitationCode, PasswordResetLink, User


class AuthFlowTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _invitation_code(self, **kwargs) -> InvitationCode:
        kwargs.setdefault("organization", self.organization)
        return InvitationCode.objects.create(**kwargs)

    def _register_and_login(self, email="guest@example.com", password="guestpass123"):
        self.client.post(
            reverse("auth-register"),
            {
                "email": email,
                "password": password,
                "invitation_code": self._invitation_code().code,
                "username": email.split("@")[0].replace("+", "_"),
            },
            format="json",
        )
        return self.client.post(
            reverse("auth-login"), {"email": email, "password": password}, format="json"
        )

    def test_register_assigns_guest_role(self):
        code = self._invitation_code()
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "new"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["roles"], ["Guest"])
        self.assertIn("article.read", response.data["permissions"])

        code.refresh_from_db()
        self.assertEqual(code.uses_count, 1)

    def test_register_rejects_duplicate_usernames(self):
        User.objects.create_user(email="existing@example.com", username="taken", organization=self.organization)

        response = self.client.post(
            reverse("auth-register"),
            {
                "email": "dup@example.com",
                "password": "somepassword123",
                "invitation_code": self._invitation_code().code,
                "username": "taken",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)
        self.assertFalse(User.objects.filter(email="dup@example.com").exists())

        response = self.client.post(
            reverse("auth-register"),
            {
                "email": "unique@example.com",
                "password": "somepassword123",
                "invitation_code": self._invitation_code().code,
                "username": "brandnew",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["username"], "brandnew")

    def test_register_requires_a_username(self):
        for payload in ({}, {"username": ""}):
            response = self.client.post(
                reverse("auth-register"),
                {
                    "email": "nousername@example.com",
                    "password": "somepassword123",
                    "invitation_code": self._invitation_code().code,
                    **payload,
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("username", response.data)
        self.assertFalse(User.objects.filter(email="nousername@example.com").exists())

    def test_register_enforces_username_length_and_format(self):
        code = self._invitation_code()
        # Too short (< 3)
        response = self.client.post(
            reverse("auth-register"),
            {"email": "short@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "ab"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

        # Too long (> 30)
        response = self.client.post(
            reverse("auth-register"),
            {"email": "long@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "a" * 31},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

        # Invalid characters
        response = self.client.post(
            reverse("auth-register"),
            {"email": "inv@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "bad user!"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

    def test_register_requires_invitation_code(self):
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="new@example.com").exists())

    def test_register_rejects_unknown_code(self):
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": "NOPE", "username": "new"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="new@example.com").exists())

    def test_register_rejects_revoked_code(self):
        code = self._invitation_code(revoked_at=timezone.now())
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "new"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_expired_code(self):
        code = self._invitation_code(expires_at=timezone.now() - timezone.timedelta(minutes=1))
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "new"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_code_used_up_to_max_uses(self):
        # Single-use by default - the first registration consumes it, so a
        # second attempt with the exact same code must be rejected even
        # though nothing about the code itself changed (revoked/expired).
        code = self._invitation_code()
        first = self.client.post(
            reverse("auth-register"),
            {"email": "first@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "first"},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            reverse("auth-register"),
            {"email": "second@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "second"},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="second@example.com").exists())

    def test_register_honors_higher_max_uses(self):
        code = self._invitation_code(max_uses=2)
        for email in ["a@example.com", "b@example.com"]:
            response = self.client.post(
                reverse("auth-register"),
                {"email": email, "password": "somepassword123", "invitation_code": code.code, "username": email[0] * 3},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        third = self.client.post(
            reverse("auth-register"),
            {"email": "c@example.com", "password": "somepassword123", "invitation_code": code.code, "username": "c__"},
            format="json",
        )
        self.assertEqual(third.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_sets_httponly_refresh_cookie_and_omits_it_from_body(self):
        response = self._register_and_login()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("refresh", response.data)
        self.assertIn("access", response.data)

        cookie = response.cookies["refresh_token"]
        self.assertTrue(cookie["httponly"])

    def test_login_accepts_username_in_place_of_email(self):
        # The wire field is still called "email" (see accounts/serializers.py's
        # CustomTokenObtainPairSerializer / User.USERNAME_FIELD), but
        # EmailOrUsernameBackend (accounts/backends.py) treats its value as
        # either credential.
        self.client.post(
            reverse("auth-register"),
            {
                "email": "handle@example.com",
                "password": "somepassword123",
                "invitation_code": self._invitation_code().code,
                "username": "somehandle",
            },
            format="json",
        )
        response = self.client.post(
            reverse("auth-login"), {"email": "somehandle", "password": "somepassword123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["email"], "handle@example.com")

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

    def test_me_patch_updates_preferences_and_get_returns_them(self):
        login_response = self._register_and_login("prefs@example.com", "prefspass123")
        access = login_response.data["access"]

        response = self.client.get(reverse("auth-me"), HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.data["preferences"], {})

        response = self.client.patch(
            reverse("auth-me"),
            {"preferences": {"engineering_list_filters": False}},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["preferences"], {"engineering_list_filters": False})

        response = self.client.get(reverse("auth-me"), HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.data["preferences"], {"engineering_list_filters": False})

    def test_me_patch_updates_username_when_valid_and_unique(self):
        login_response = self._register_and_login("meuser@example.com", "meuserpass123")
        access = login_response.data["access"]
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "new_handle"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], "new_handle")

    def test_me_patch_same_username_does_not_collide(self):
        login_response = self._register_and_login("sameuser@example.com", "sameuserpass123")
        access = login_response.data["access"]
        user = User.objects.get(email="sameuser@example.com")
        response = self.client.patch(
            reverse("auth-me"),
            {"username": user.username},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], user.username)

    def test_me_patch_rejects_removing_username_completely(self):
        login_response = self._register_and_login("noremove@example.com", "noremovepass123")
        access = login_response.data["access"]
        for empty_val in ("", "   ", None):
            response = self.client.patch(
                reverse("auth-me"),
                {"username": empty_val},
                format="json",
                HTTP_AUTHORIZATION=f"Bearer {access}",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("username", response.data)

    def test_me_patch_rejects_username_length_and_format_violations(self):
        login_response = self._register_and_login("lenuser@example.com", "lenuserpass123")
        access = login_response.data["access"]
        # Too short (< 3)
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "ab"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

        # Too long (> 30)
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "a" * 31},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

        # Invalid characters
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "bad user!"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

    def test_me_patch_rejects_already_existing_username(self):
        User.objects.create_user(email="other@example.com", username="taken_name", organization=self.organization)
        user = User.objects.create_user(email="clashuser@example.com", username="clashuser", organization=self.organization)
        from rest_framework_simplejwt.tokens import RefreshToken
        access = str(RefreshToken.for_user(user).access_token)
        # Exact clash
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "taken_name"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

        # Case-insensitive clash
        response = self.client.patch(
            reverse("auth-me"),
            {"username": "TAKEN_NAME"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

    def test_me_patch_sets_and_clears_profile_picture(self):
        login_response = self._register_and_login("avatar@example.com", "avatarpass123")
        access = login_response.data["access"]
        user = User.objects.get(email="avatar@example.com")

        avatar_file = StoredFile.objects.create(
            organization=user.organization,
            file=SimpleUploadedFile("avatar.png", b"fake-png-bytes", content_type="image/png"),
            original_filename="avatar.png",
            content_type="image/png",
            size=14,
        )
        response = self.client.patch(
            reverse("auth-me"),
            {"profile_picture_id": str(avatar_file.pk)},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["profile_picture"]["id"], str(avatar_file.pk))
        self.assertEqual(response.data["profile_picture"]["download_url"], f"/api/v1/files/{avatar_file.pk}/download/")

        response = self.client.patch(
            reverse("auth-me"),
            {"profile_picture_id": None},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["profile_picture"])

    def test_me_patch_rejects_profile_picture_from_another_organization(self):
        login_response = self._register_and_login("avatarcross@example.com", "avatarpass123")
        access = login_response.data["access"]

        other_organization = create_test_organization(name="Someone Else's Org")
        other_file = StoredFile.objects.create(
            organization=other_organization,
            file=SimpleUploadedFile("avatar.png", b"fake-png-bytes", content_type="image/png"),
            original_filename="avatar.png",
            content_type="image/png",
            size=14,
        )
        response = self.client.patch(
            reverse("auth-me"),
            {"profile_picture_id": str(other_file.pk)},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

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

    # Throttling is off for this file (config/settings.py `if "test" in sys.argv`) since
    # _register_and_login runs dozens of times; this test re-enables a tight "auth" rate to prove
    # the throttle engages. ScopedRateThrottle.THROTTLE_RATES is bound at import time, so
    # @override_settings doesn't reach it and the dict itself has to be patched.
    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/min"})
    def test_login_is_rate_limited_after_repeated_attempts(self):
        cache.clear()
        User.objects.create_user(
            email="throttled@example.com", password="correctpassword123", organization=self.organization
        )

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


    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/min"})
    def test_login_throttle_ignores_a_spoofed_x_forwarded_for(self):
        # nginx overwrites X-Forwarded-For with the real peer address, and
        # NUM_PROXIES=1 makes DRF key on that last entry only - so rotating
        # a fake client-supplied prefix must NOT buy a fresh rate-limit
        # bucket per request (it used to: the whole header was the key).
        cache.clear()
        for i in range(3):
            response = self.client.post(
                reverse("auth-login"),
                {"email": "nobody@example.com", "password": "wrong"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}, 203.0.113.7",
            )
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        response = self.client.post(
            reverse("auth-login"),
            {"email": "nobody@example.com", "password": "wrong"},
            format="json",
            HTTP_X_FORWARDED_FOR="10.0.0.99, 203.0.113.7",
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_register_rejects_a_case_variant_of_an_existing_email(self):
        User.objects.create_user(email="alice@example.com", password="correctpassword123", organization=self.organization)
        response = self.client.post(
            reverse("auth-register"),
            {"email": "ALICE@Example.com", "password": "somepassword123", "invitation_code": self._invitation_code().code, "username": "ALICE"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data)
        # ...and the original owner can still log in, which is the actual
        # harm this prevents (login refuses ambiguous case-insensitive matches).
        response = self.client.post(
            reverse("auth-login"), {"email": "alice@example.com", "password": "correctpassword123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_register_rejects_a_case_variant_of_an_existing_username(self):
        User.objects.create_user(email="bob@example.com", username="bob", organization=self.organization)
        response = self.client.post(
            reverse("auth-register"),
            {
                "email": "bob2@example.com",
                "username": "BOB",
                "password": "somepassword123",
                "invitation_code": self._invitation_code().code,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data)

    def test_emails_are_stored_lowercased(self):
        user = User.objects.create_user(email="  Mixed.Case@Example.COM ", organization=self.organization)
        self.assertEqual(user.email, "mixed.case@example.com")

    def test_register_rejects_weak_passwords(self):
        for weak in ("12345678", "password", "guest@example.com"):
            response = self.client.post(
                reverse("auth-register"),
                {
                    "email": "guest@example.com",
                    "password": weak,
                    "invitation_code": self._invitation_code().code,
                    "username": "guest",
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, weak)
            self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(email="guest@example.com").exists())

    def test_malformed_x_forwarded_for_does_not_break_login(self):
        # audit.services._client_ip used to save the header's first entry
        # straight into a GenericIPAddressField - a non-IP value 500'd login.
        User.objects.create_user(email="ip@example.com", password="correctpassword123", organization=self.organization)
        response = self.client.post(
            reverse("auth-login"),
            {"email": "ip@example.com", "password": "correctpassword123"},
            format="json",
            HTTP_X_FORWARDED_FOR="not-an-ip",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_audit_log_records_the_proxy_seen_address_not_the_client_claimed_one(self):
        from audit.models import AuditLog

        User.objects.create_user(email="ip2@example.com", password="correctpassword123", organization=self.organization)
        self.client.post(
            reverse("auth-login"),
            {"email": "ip2@example.com", "password": "correctpassword123"},
            format="json",
            HTTP_X_FORWARDED_FOR="1.2.3.4, 203.0.113.9",
        )
        entry = AuditLog.objects.filter(action="auth.login").latest("created_at")
        self.assertEqual(entry.ip_address, "203.0.113.9")


class InvitationCodeAdminTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_list_and_create_require_user_manage_permission(self):
        _, guest_access = self._login_with_role("guest@example.com", "Guest")
        response = self.client.get(reverse("auth-invitation-list-create"), **self._auth(guest_access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse("auth-invitation-list-create"), {}, format="json", **self._auth(guest_access)
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_list_and_revoke(self):
        admin, admin_access = self._login_with_role("admin@example.com", "Organization Admin")

        create_response = self.client.post(
            reverse("auth-invitation-list-create"), {"max_uses": 5}, format="json", **self._auth(admin_access)
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(create_response.data["max_uses"], 5)
        self.assertEqual(create_response.data["uses_count"], 0)
        self.assertTrue(create_response.data["is_valid"])
        self.assertEqual(create_response.data["created_by"], "admin@example.com")

        list_response = self.client.get(reverse("auth-invitation-list-create"), **self._auth(admin_access))
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data["count"], 1)

        code_id = create_response.data["id"]
        revoke_response = self.client.post(
            reverse("auth-invitation-revoke", args=[code_id]), **self._auth(admin_access)
        )
        self.assertEqual(revoke_response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(revoke_response.data["revoked_at"])
        self.assertFalse(revoke_response.data["is_valid"])

        # A revoked code can no longer be used to register.
        register_response = self.client.post(
            reverse("auth-register"),
            {
                "email": "toolate@example.com",
                "password": "somepassword123",
                "invitation_code": InvitationCode.objects.get(pk=code_id).code,
            },
            format="json",
        )
        self.assertEqual(register_response.status_code, status.HTTP_400_BAD_REQUEST)


class PasswordResetLinkTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _user(self, email, role_name=None, password="OldPassw0rd!x", organization=None):
        user = User.objects.create_user(email=email, password=password, organization=organization or self.organization)
        if role_name:
            Role.objects.get(organization=user.organization, name=role_name).user_roles.create(user=user)
        return user

    def _login(self, email, password="OldPassw0rd!x"):
        return self.client.post(reverse("auth-login"), {"email": email, "password": password}, format="json")

    def _auth(self, email, password="OldPassw0rd!x"):
        return {"HTTP_AUTHORIZATION": f"Bearer {self._login(email, password).data['access']}"}

    def _generate(self, admin_email, target):
        return self.client.post(
            reverse("auth-user-password-reset-link", args=[target.id]), format="json", **self._auth(admin_email)
        )

    def setUp(self):
        self.admin = self._user("reset-admin@example.com", "Organization Admin")
        self.member = self._user("reset-member@example.com", "Member")

    def test_full_reset_flow_and_link_is_single_use(self):
        response = self._generate(self.admin.email, self.member)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        token = response.data["token"]
        self.assertEqual(response.data["email"], self.member.email)
        # Only the hash is stored.
        self.assertFalse(PasswordResetLink.objects.filter(token_hash=token).exists())

        response = self.client.post(reverse("auth-password-reset-check"), {"token": token}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], self.member.email)

        # An existing session is revoked by the reset.
        old_refresh = self._login(self.member.email).cookies[settings.JWT_REFRESH_COOKIE_NAME].value

        response = self.client.post(
            reverse("auth-password-reset-confirm"), {"token": token, "password": "BrandNewPassw0rd!"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self._login(self.member.email, "BrandNewPassw0rd!").status_code, status.HTTP_200_OK)
        self.assertNotEqual(self._login(self.member.email).status_code, status.HTTP_200_OK)

        self.client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = old_refresh
        self.assertEqual(self.client.post(reverse("auth-refresh")).status_code, status.HTTP_401_UNAUTHORIZED)

        # Used once - now dead.
        response = self.client.post(
            reverse("auth-password-reset-confirm"), {"token": token, "password": "AnotherPassw0rd!"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_new_link_replaces_old_and_expired_or_bogus_links_fail(self):
        first = self._generate(self.admin.email, self.member).data["token"]
        second = self._generate(self.admin.email, self.member).data["token"]
        check = reverse("auth-password-reset-check")
        self.assertEqual(self.client.post(check, {"token": first}, format="json").status_code, 404)
        self.assertEqual(self.client.post(check, {"token": second}, format="json").status_code, 200)
        self.assertEqual(self.client.post(check, {"token": "not-a-real-token"}, format="json").status_code, 404)

        PasswordResetLink.objects.filter(user=self.member).update(expires_at=timezone.now())
        self.assertEqual(self.client.post(check, {"token": second}, format="json").status_code, 404)

    def test_weak_password_is_rejected_and_link_stays_usable(self):
        token = self._generate(self.admin.email, self.member).data["token"]
        response = self.client.post(
            reverse("auth-password-reset-confirm"), {"token": token, "password": "12345678"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post(reverse("auth-password-reset-check"), {"token": token}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_generation_requires_user_manage_and_same_org(self):
        response = self._generate(self.member.email, self.admin)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        other_org = create_test_organization(name="Elsewhere")
        stranger = self._user("reset-stranger@example.com", "Member", organization=other_org)
        response = self._generate(self.admin.email, stranger)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_reset_self_blocked_or_more_privileged_users(self):
        self.assertEqual(self._generate(self.admin.email, self.admin).status_code, status.HTTP_403_FORBIDDEN)

        blocked = self._user("reset-blocked@example.com", "Member")
        blocked.is_active = False
        blocked.save()
        self.assertEqual(self._generate(self.admin.email, blocked).status_code, status.HTTP_400_BAD_REQUEST)

        # A user.manage holder without the admin's other permissions can't
        # take over the admin's account.
        manager_role = Role.objects.create(organization=self.organization, name="User Manager")
        manager_role.permissions.add(Permission.objects.get(codename="user.manage"))
        manager = self._user("reset-manager@example.com")
        manager_role.user_roles.create(user=manager)
        self.assertEqual(self._generate(manager.email, self.admin).status_code, status.HTTP_403_FORBIDDEN)

    # Same pattern as AuthFlowTests' login throttle test: throttling is off in
    # tests, so re-enable a tight "auth" rate to prove both public reset
    # endpoints actually engage it (they're unauthenticated, so the limit is
    # keyed on the client IP).
    @patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"auth": "3/min"})
    def test_public_reset_endpoints_are_rate_limited(self):
        for url_name, body in (
            ("auth-password-reset-check", {"token": "guess"}),
            ("auth-password-reset-confirm", {"token": "guess", "password": "SomePassw0rd!"}),
        ):
            cache.clear()
            for _ in range(3):
                response = self.client.post(reverse(url_name), body, format="json")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
            response = self.client.post(reverse(url_name), body, format="json")
            self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS, url_name)


    def _generate_with_email(self, body):
        return self.client.post(
            reverse("auth-user-password-reset-link", args=[self.member.id]),
            body,
            format="json",
            **self._auth(self.admin.email),
        )

    @override_settings(
        EMAIL_ENABLED=True,
        MAILERS={"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}},
        CORS_ALLOWED_ORIGINS=["http://app.example.com"],
    )
    def test_link_can_be_emailed_to_the_user(self):
        response = self._generate_with_email(
            {"send_email": True, "link_base": "http://app.example.com/ar/reset-password", "language": "ar"}
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["email_sent"])
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, [self.member.email])
        link = f"http://app.example.com/ar/reset-password#{response.data['token']}"
        self.assertIn(link, message.body)
        self.assertIn(link, message.alternatives[0][0])
        self.assertIn('dir="rtl"', message.alternatives[0][0])

    @override_settings(
        EMAIL_ENABLED=True,
        MAILERS={"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}},
        CORS_ALLOWED_ORIGINS=["http://app.example.com"],
    )
    def test_emailed_link_must_point_at_a_trusted_origin(self):
        for link_base in (
            "http://evil.example.com/en/reset-password",
            "http://app.example.com/en/reset-password?next=x",
        ):
            response = self._generate_with_email({"send_email": True, "link_base": link_base})
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, link_base)
        self.assertEqual(len(mail.outbox), 0)
        # A rejected request creates no link either.
        self.assertFalse(PasswordResetLink.objects.filter(user=self.member).exists())

    @override_settings(EMAIL_ENABLED=False, CORS_ALLOWED_ORIGINS=["http://app.example.com"])
    def test_cannot_request_email_when_email_is_not_configured(self):
        response = self._generate_with_email(
            {"send_email": True, "link_base": "http://app.example.com/en/reset-password"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(EMAIL_ENABLED=True, CORS_ALLOWED_ORIGINS=["http://app.example.com"])
    def test_send_failure_still_returns_the_link(self):
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("smtp down")):
            response = self._generate_with_email(
                {"send_email": True, "link_base": "http://app.example.com/en/reset-password"}
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data["email_sent"])
        self.assertTrue(response.data["token"])


    def _request_reset(self, email):
        return self.client.post(
            reverse("auth-password-reset-request"),
            {"email": email, "link_base": "http://app.example.com/en/reset-password"},
            format="json",
        )

    @override_settings(
        EMAIL_ENABLED=True,
        MAILERS={"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}},
        CORS_ALLOWED_ORIGINS=["http://app.example.com"],
    )
    def test_self_service_request_emails_a_working_link(self):
        response = self._request_reset(self.member.email.upper())
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.member.email])
        self.assertIn("We received a request", mail.outbox[0].body)
        link = PasswordResetLink.objects.get(user=self.member)
        self.assertIsNone(link.created_by)

        token = mail.outbox[0].body.split("reset-password#", 1)[1].split()[0]
        response = self.client.post(
            reverse("auth-password-reset-confirm"), {"token": token, "password": "BrandNewPassw0rd!"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    @override_settings(
        EMAIL_ENABLED=True,
        MAILERS={"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}},
        CORS_ALLOWED_ORIGINS=["http://app.example.com"],
    )
    def test_self_service_request_does_not_reveal_accounts_and_has_a_cooldown(self):
        blocked = self._user("reset-blocked2@example.com", "Member")
        blocked.is_active = False
        blocked.save()
        for email in ("nobody@example.com", blocked.email):
            response = self._request_reset(email)
            self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(len(mail.outbox), 0)

        self._request_reset(self.member.email)
        self.assertEqual(self._request_reset(self.member.email).status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(PasswordResetLink.objects.filter(user=self.member).count(), 1)

    @override_settings(EMAIL_ENABLED=False, CORS_ALLOWED_ORIGINS=["http://app.example.com"])
    def test_self_service_request_needs_email_configured(self):
        self.assertEqual(self._request_reset(self.member.email).status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(EMAIL_ENABLED=True, CORS_ALLOWED_ORIGINS=["http://app.example.com"])
    def test_self_service_request_rejects_foreign_link_base(self):
        response = self.client.post(
            reverse("auth-password-reset-request"),
            {"email": self.member.email, "link_base": "http://evil.example.com/en/reset-password"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


    @override_settings(
        EMAIL_ENABLED=True,
        MAILERS={"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}},
        CORS_ALLOWED_ORIGINS=["http://app.example.com"],
    )
    def test_email_embeds_the_org_logo_and_athar_footer(self):
        from organization.models import OrganizationSettings

        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
        org_settings = OrganizationSettings.load(self.organization)
        org_settings.logo = StoredFile.objects.create(
            organization=self.organization,
            file=SimpleUploadedFile("logo.png", png, content_type="image/png"),
            original_filename="logo.png",
            content_type="image/png",
        )
        org_settings.save()

        self._generate_with_email({"send_email": True, "link_base": "http://app.example.com/en/reset-password"})
        message = mail.outbox[0].message()
        types = [part.get_content_type() for part in message.walk()]
        self.assertEqual(types, ["multipart/alternative", "text/plain", "multipart/related", "text/html", "image/png"])
        logo = next(part for part in message.walk() if part.get_content_type() == "image/png")
        self.assertEqual(logo["Content-ID"], "<org-logo>")
        self.assertEqual(logo.get_content(), png)
        html = mail.outbox[0].alternatives[0][0]
        self.assertIn('src="cid:org-logo"', html)
        self.assertIn("Sent by Athar", html)
        self.assertIn('href="http://app.example.com"', html)
        self.assertNotIn("github.com", html)
        self.assertIn("Sent by Athar", mail.outbox[0].body)


def _login_client(email: str, password: str = "password123") -> APIClient:
    """A client holding a fresh refresh cookie for `email` (one browser session)."""
    client = APIClient()
    response = client.post(reverse("auth-login"), {"email": email, "password": password}, format="json")
    assert response.status_code == 200, response.data
    return client


def _refresh_cookie(client: APIClient) -> str:
    return client.cookies[settings.JWT_REFRESH_COOKIE_NAME].value


class RefreshTokenSecurityTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()
        cls.user = User.objects.create_user(email="rt@example.com", password="password123", organization=cls.organization)
        cls.other_user = User.objects.create_user(
            email="rt-other@example.com", password="password123", organization=cls.organization
        )

    def _refresh_with(self, cookie: str):
        client = APIClient()
        client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie
        return client.post(reverse("auth-refresh"))

    def test_refresh_rotates_the_cookie_and_returns_an_access_token(self):
        client = _login_client("rt@example.com")
        old_cookie = _refresh_cookie(client)

        response = client.post(reverse("auth-refresh"))

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertNotEqual(_refresh_cookie(client), old_cookie)

    def test_expired_refresh_token_is_rejected(self):
        token = RefreshToken.for_user(self.user)
        token.set_exp(lifetime=-datetime.timedelta(seconds=5))

        self.assertEqual(self._refresh_with(str(token)).status_code, 401)

    def test_garbage_cookie_is_rejected_without_revoking_sessions(self):
        session = _login_client("rt@example.com")

        self.assertEqual(self._refresh_with("not-a-token").status_code, 401)
        self.assertEqual(session.post(reverse("auth-refresh")).status_code, 200)

    def test_logout_blacklists_the_refresh_token(self):
        client = _login_client("rt@example.com")
        cookie = _refresh_cookie(client)

        self.assertEqual(client.post(reverse("auth-logout")).status_code, 204)

        self.assertEqual(self._refresh_with(cookie).status_code, 401)

    def test_replaying_a_rotated_token_after_the_grace_window_revokes_every_session(self):
        stolen_session = _login_client("rt@example.com")
        other_device = _login_client("rt@example.com")
        old_cookie = _refresh_cookie(stolen_session)
        stolen_session.post(reverse("auth-refresh"))  # the legitimate holder rotates it
        legit_cookie = _refresh_cookie(stolen_session)

        with override_settings(JWT_REFRESH_REUSE_GRACE_SECONDS=0):
            self.assertEqual(self._refresh_with(old_cookie).status_code, 401)  # the thief replays it

        self.assertEqual(self._refresh_with(legit_cookie).status_code, 401)
        self.assertEqual(other_device.post(reverse("auth-refresh")).status_code, 401)
        entry = AuditLog.objects.get(action="auth.refresh_reuse")
        self.assertEqual(entry.actor, self.user)
        self.assertEqual(entry.metadata["revoked_sessions"], 2)

    def test_token_reuse_is_reported_on_the_security_logger_for_alerting(self):
        client = _login_client("rt@example.com")
        old_cookie = _refresh_cookie(client)
        client.post(reverse("auth-refresh"))

        with override_settings(JWT_REFRESH_REUSE_GRACE_SECONDS=0), self.assertLogs("athar.security", "ERROR") as logs:
            self._refresh_with(old_cookie)

        self.assertIn("Refresh token reuse detected", logs.output[0])

    def test_replay_inside_the_grace_window_fails_only_that_request(self):
        client = _login_client("rt@example.com")
        old_cookie = _refresh_cookie(client)
        client.post(reverse("auth-refresh"))

        self.assertEqual(self._refresh_with(old_cookie).status_code, 401)

        self.assertEqual(client.post(reverse("auth-refresh")).status_code, 200)
        self.assertFalse(AuditLog.objects.filter(action="auth.refresh_reuse").exists())

    def test_reuse_does_not_touch_other_users_sessions(self):
        victim = _login_client("rt@example.com")
        bystander = _login_client("rt-other@example.com")
        old_cookie = _refresh_cookie(victim)
        victim.post(reverse("auth-refresh"))

        with override_settings(JWT_REFRESH_REUSE_GRACE_SECONDS=0):
            self._refresh_with(old_cookie)

        self.assertEqual(bystander.post(reverse("auth-refresh")).status_code, 200)

    def test_replaying_a_logged_out_token_revokes_sessions(self):
        client = _login_client("rt@example.com")
        other_device = _login_client("rt@example.com")
        cookie = _refresh_cookie(client)
        client.post(reverse("auth-logout"))

        with override_settings(JWT_REFRESH_REUSE_GRACE_SECONDS=0):
            self.assertEqual(self._refresh_with(cookie).status_code, 401)

        self.assertEqual(other_device.post(reverse("auth-refresh")).status_code, 401)


class RefreshTokenConcurrencyTests(TransactionTestCase):
    """Real threads and connections (hence TransactionTestCase): the row lock in RefreshView must
    let exactly one of two simultaneous refreshes with the same cookie rotate it."""

    def test_only_one_of_two_simultaneous_refreshes_succeeds(self):
        organization = create_test_organization()
        User.objects.create_user(email="race@example.com", password="password123", organization=organization)
        cookie = _refresh_cookie(_login_client("race@example.com"))
        barrier = threading.Barrier(2)
        statuses = []

        def refresh():
            try:
                client = APIClient()
                client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie
                barrier.wait(timeout=10)
                statuses.append(client.post(reverse("auth-refresh")).status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=refresh) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        self.assertEqual(sorted(statuses), [200, 401])
        self.assertFalse(AuditLog.objects.filter(action="auth.refresh_reuse").exists())


class AccountDataTests(RoleLoginMixin, APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _auth(self, access):
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _article(self, author, title):
        return Article.objects.create(organization=self.organization, title=title, slug=title.lower(), author=author)

    def test_export_contains_the_users_data_and_nothing_else(self):
        user, access = self._login_with_role("me@example.com", "Member")
        other, _ = self._login_with_role("other@example.com", "Member")
        mine = self._article(user, "Mine")
        self._article(other, "Theirs")
        Bookmark.objects.create(
            organization=self.organization,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=mine.pk,
            user=user,
        )

        response = self.client.get(reverse("auth-me-export"), **self._auth(access))

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        data = json.loads(response.content)
        self.assertEqual(data["profile"]["email"], "me@example.com")
        self.assertEqual(data["profile"]["roles"], ["Member"])
        self.assertEqual([row["title"] for row in data["authored_content"]["articles"]], ["Mine"])
        self.assertEqual(len(data["personal_records"]["bookmarks"]), 1)
        self.assertTrue(any(entry["action"] == "auth.login" for entry in data["activity_log"]))
        self.assertNotIn("password", response.content.decode().lower())
        self.assertNotIn("other@example.com", response.content.decode())
        self.assertTrue(AuditLog.objects.filter(actor=user, action="account.export").exists())

    def test_export_requires_authentication(self):
        self.assertEqual(self.client.get(reverse("auth-me-export")).status_code, 401)

    def test_delete_requires_the_correct_password(self):
        user, access = self._login_with_role("keep@example.com", "Member")

        response = self.client.post(reverse("auth-me-delete"), {"password": "wrong"}, format="json", **self._auth(access))

        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=user.pk).exists())

    def test_delete_removes_the_account_but_keeps_its_content_anonymously(self):
        user, access = self._login_with_role("leaving@example.com", "Member")
        article = self._article(user, "Kept")
        Bookmark.objects.create(
            organization=self.organization,
            content_type=ContentType.objects.get_for_model(Article),
            object_id=article.pk,
            user=user,
        )
        own_entries = list(AuditLog.objects.filter(actor=user).values_list("pk", flat=True))
        self.assertTrue(AuditLog.objects.filter(pk__in=own_entries, ip_address__isnull=False).exists())

        response = self.client.post(
            reverse("auth-me-delete"), {"password": "password123"}, format="json", **self._auth(access)
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())
        article.refresh_from_db()
        self.assertIsNone(article.author)
        self.assertFalse(Bookmark.objects.filter(object_id=article.pk).exists())
        scrubbed = AuditLog.objects.filter(pk__in=own_entries)
        self.assertTrue(scrubbed.exists())
        self.assertFalse(scrubbed.exclude(ip_address=None).exists())
        self.assertFalse(scrubbed.exclude(user_agent="").exists())
        deleted_entry = AuditLog.objects.get(action="account.delete")
        self.assertIsNone(deleted_entry.actor)
        self.assertEqual(deleted_entry.metadata, {"user_id": str(user.pk)})
        self.assertNotIn("leaving@example.com", str(deleted_entry.metadata) + deleted_entry.target_repr)

    def test_deleting_an_account_ends_its_sessions(self):
        user, access = self._login_with_role("sessions@example.com", "Member")
        other_device = _login_client("sessions@example.com")

        self.client.post(reverse("auth-me-delete"), {"password": "password123"}, format="json", **self._auth(access))

        self.assertEqual(other_device.post(reverse("auth-refresh")).status_code, 401)
        self.assertEqual(self.client.get(reverse("auth-me"), **self._auth(access)).status_code, 401)

    def test_the_only_organization_admin_cannot_delete_their_account(self):
        admin, access = self._login_with_role("solo-admin@example.com", "Organization Admin")

        response = self.client.post(reverse("auth-me-delete"), {"password": "password123"}, format="json", **self._auth(access))

        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=admin.pk).exists())

        self._login_with_role("second-admin@example.com", "Organization Admin")
        response = self.client.post(reverse("auth-me-delete"), {"password": "password123"}, format="json", **self._auth(access))

        self.assertEqual(response.status_code, 204)
