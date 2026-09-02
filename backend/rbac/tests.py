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
