from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from core.testing import create_test_organization
from files.models import StoredFile
from rbac.models import Role

from .models import InvitationCode, User


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
            {"email": email, "password": password, "invitation_code": self._invitation_code().code},
            format="json",
        )
        return self.client.post(
            reverse("auth-login"), {"email": email, "password": password}, format="json"
        )

    def test_register_assigns_guest_role(self):
        code = self._invitation_code()
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["roles"], ["Guest"])
        self.assertIn("article.read", response.data["permissions"])

        code.refresh_from_db()
        self.assertEqual(code.uses_count, 1)

    def test_register_accepts_optional_username_and_rejects_duplicates(self):
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
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": "NOPE"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="new@example.com").exists())

    def test_register_rejects_revoked_code(self):
        code = self._invitation_code(revoked_at=timezone.now())
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_expired_code(self):
        code = self._invitation_code(expires_at=timezone.now() - timezone.timedelta(minutes=1))
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "password": "somepassword123", "invitation_code": code.code},
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
            {"email": "first@example.com", "password": "somepassword123", "invitation_code": code.code},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            reverse("auth-register"),
            {"email": "second@example.com", "password": "somepassword123", "invitation_code": code.code},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="second@example.com").exists())

    def test_register_honors_higher_max_uses(self):
        code = self._invitation_code(max_uses=2)
        for email in ["a@example.com", "b@example.com"]:
            response = self.client.post(
                reverse("auth-register"),
                {"email": email, "password": "somepassword123", "invitation_code": code.code},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        third = self.client.post(
            reverse("auth-register"),
            {"email": "c@example.com", "password": "somepassword123", "invitation_code": code.code},
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


class InvitationCodeAdminTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _login_with_role(self, email, role_name):
        user = User.objects.create_user(email=email, password="password123", organization=self.organization)
        Role.objects.get(organization=self.organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(reverse("auth-login"), {"email": email, "password": "password123"}, format="json")
        return user, response.data["access"]

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
