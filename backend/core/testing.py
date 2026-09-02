"""Shared test-organization bootstrap - every app's test suite needs a real
Organization (with its own seeded Role catalogue) to create users against,
now that accounts.User.organization is required. Centralized here rather
than duplicated per app's tests.py, so the multi-tenancy retrofit's test
fixture shape can't drift between apps."""

import uuid

from organization.models import Organization
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
