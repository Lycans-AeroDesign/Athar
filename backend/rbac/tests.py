from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.testing import create_test_organization
from accounts.models import User

from .models import Permission, Role


class PermissionEnforcementTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()

    def _access_token_for(self, email, password):
        User.objects.create_user(email=email, password=password, organization=self.organization)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": password}, format="json"
        )
        return response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_user_without_permission_is_forbidden(self):
        guest_role = Role.objects.get(organization=self.organization, name="Guest")
        user = User.objects.create_user(email="plain@example.com", password="password123", organization=self.organization)
        guest_role.user_roles.create(user=user)
        access = self.client.post(
            reverse("auth-login"),
            {"email": "plain@example.com", "password": "password123"},
            format="json",
        ).data["access"]

        response = self.client.get(reverse("rbac-roles"), **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_granting_permission_to_role_unlocks_access_with_no_code_change(self):
        guest_role = Role.objects.get(organization=self.organization, name="Guest")
        user = User.objects.create_user(email="plain2@example.com", password="password123", organization=self.organization)
        guest_role.user_roles.create(user=user)
        access = self.client.post(
            reverse("auth-login"),
            {"email": "plain2@example.com", "password": "password123"},
            format="json",
        ).data["access"]

        forbidden = self.client.get(reverse("rbac-roles"), **self._auth(access))
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        role_manage = Permission.objects.get(codename="role.manage")
        guest_role.permissions.add(role_manage)

        # Same access token, same view, zero code change - purely a data change.
        allowed = self.client.get(reverse("rbac-roles"), **self._auth(access))
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)

    def test_superuser_bypasses_permission_checks(self):
        superuser = User.objects.create_superuser(
            email="admin@example.com", password="password123", organization=self.organization
        )
        self.assertTrue(superuser.has_permission("anything.not.in.catalogue"))

    def test_role_permission_crud_is_audited(self):
        from audit.models import AuditLog

        admin = User.objects.create_superuser(
            email="admin2@example.com", password="password123", organization=self.organization
        )
        access = self.client.post(
            reverse("auth-login"),
            {"email": "admin2@example.com", "password": "password123"},
            format="json",
        ).data["access"]

        response = self.client.post(
            reverse("rbac-roles"),
            {"name": "Custom Role", "description": "test"},
            format="json",
            **self._auth(access),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(AuditLog.objects.filter(action="role.create", actor=admin).exists())


class UserBlockUnblockTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organization = create_test_organization()
        cls.other_organization = create_test_organization(name="Other Org For Block")

    def _login_with_role(self, email, role_name, organization=None):
        organization = organization or self.organization
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(
            reverse("auth-login"), {"email": email, "password": "password123"}, format="json"
        )
        return user, response.data["access"]

    def _auth(self, access_token):
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_admin_blocks_and_unblocks_a_user(self):
        _, admin_access = self._login_with_role("blockadmin@example.com", "Organization Admin")
        member, member_access = self._login_with_role("blockmember@example.com", "Member")

        response = self.client.post(
            reverse("rbac-user-active", args=[member.id]),
            {"is_active": False},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["is_active"])
        member.refresh_from_db()
        self.assertFalse(member.is_active)

        # The blocked user's still-live access token is rejected on its very
        # next request - no separate session/token invalidation needed.
        response = self.client.get(reverse("rbac-roles"), **self._auth(member_access))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # And they can't log in again either.
        response = self.client.post(
            reverse("auth-login"), {"email": "blockmember@example.com", "password": "password123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # Unblock restores both.
        response = self.client.post(
            reverse("rbac-user-active", args=[member.id]),
            {"is_active": True},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_active"])
        response = self.client.post(
            reverse("auth-login"), {"email": "blockmember@example.com", "password": "password123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_non_privileged_caller_cannot_block(self):
        _, member_access = self._login_with_role("blockplain@example.com", "Member")
        other, _ = self._login_with_role("blocktarget@example.com", "Member")

        response = self.client.post(
            reverse("rbac-user-active", args=[other.id]),
            {"is_active": False},
            format="json",
            **self._auth(member_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_cannot_block_themselves(self):
        admin, admin_access = self._login_with_role("blockself@example.com", "Organization Admin")

        response = self.client.post(
            reverse("rbac-user-active", args=[admin.id]),
            {"is_active": False},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_cannot_block_a_user_in_another_organization(self):
        _, admin_access = self._login_with_role("blockcrossadmin@example.com", "Organization Admin")
        other_org_user, _ = self._login_with_role(
            "blockcrosstarget@example.com", "Member", self.other_organization
        )

        response = self.client.post(
            reverse("rbac-user-active", args=[other_org_user.id]),
            {"is_active": False},
            format="json",
            **self._auth(admin_access),
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
