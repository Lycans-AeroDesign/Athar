from django.core.management.base import BaseCommand
from django.db import transaction

from organization.models import Organization
from rbac.services import seed_permissions, seed_rbac_for_organization


class Command(BaseCommand):
    help = (
        "Idempotently seed the global permission catalogue, then the standard "
        "role catalogue into every existing organization. The dev/self-hosted "
        "bootstrap path - self-service org creation (organization.services."
        "create_organization) calls seed_rbac_for_organization directly for a "
        "brand-new org, so this command mainly matters pre-org-creation or "
        "after a fresh `migrate` on an empty database."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        permissions_by_codename = seed_permissions()

        created_roles = 0
        organizations = list(Organization.objects.all())
        for organization in organizations:
            created_roles += seed_rbac_for_organization(organization)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded RBAC catalogue: {len(permissions_by_codename)} permissions checked, "
                f"{created_roles} new roles across {len(organizations)} organization(s)."
            )
        )
