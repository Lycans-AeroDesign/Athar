from django.db import migrations

# Every self-hosted install needs at least one Organization to exist right
# after a fresh `migrate` - self-service signup (organization.services.
# create_organization) still works fine on top of this, but a single-org
# deployment (the primary use case, see README) shouldn't have to go through
# that flow just to get its first organization. This fixed all-zero UUID is
# also what backend/rbac/migrations/0002_seed_bootstrap_rbac.py seeds roles
# for, and what accounts.management.commands.bootstrap_admin resolves by
# default when exactly one organization exists.
BOOTSTRAP_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000"


def create_bootstrap_organization(apps, schema_editor):
    Organization = apps.get_model("organization", "Organization")
    Organization.objects.get_or_create(
        id=BOOTSTRAP_ORGANIZATION_ID,
        defaults={"name": "Default Organization", "slug": "default"},
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_bootstrap_organization, noop_reverse),
    ]
