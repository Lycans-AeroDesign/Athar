"""Shared test-organization bootstrap - every app's test suite needs a real
Organization (with its own seeded Role catalogue) to create users against,
now that accounts.User.organization is required. Centralized here rather
than duplicated per app's tests.py, so the multi-tenancy retrofit's test
fixture shape can't drift between apps."""

import uuid

from django.urls import reverse

from accounts.models import User
from organization.models import Organization
from rbac.models import Role
from rbac.services import seed_rbac_for_organization


def create_test_organization(name: str | None = None):
    """A fresh, fully-seeded Organization for one TestCase class. Randomized
    slug (not a fixed constant) so parallel/sequential TestCase classes
    across the whole suite never collide on Organization.slug's uniqueness,
    even though each class's own rows are rolled back after it runs."""
    suffix = uuid.uuid4().hex[:8]
    organization = Organization.objects.create(name=name or f"Test Org {suffix}", slug=f"test-org-{suffix}")
    seed_rbac_for_organization(organization)
    return organization


class RoleLoginMixin:
    """For an APITestCase with `self.organization`: creates a user holding the named role and
    logs them in, returning (user, access_token). `organization` defaults to `self.organization`."""

    def _login_with_role(self, email, role_name, organization=None):
        organization = organization or self.organization
        user = User.objects.create_user(email=email, password="password123", organization=organization)
        Role.objects.get(organization=organization, name=role_name).user_roles.create(user=user)
        response = self.client.post(reverse("auth-login"), {"email": email, "password": "password123"}, format="json")
        return user, response.data["access"]
