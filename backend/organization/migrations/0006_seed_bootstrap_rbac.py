from django.db import migrations

# Same fixed id organization.0005 creates the bootstrap Organization at.
BOOTSTRAP_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000"


def seed_bootstrap_rbac(apps, schema_editor):
    """Seeds the bootstrap Organization's RBAC catalogue - split into its
    own migration (rather than done inside organization.0005 itself)
    specifically so it can depend on rbac's migration that adds
    Role.organization, without creating a dependency cycle (that rbac
    migration already depends on organization.0005 for the Organization
    model its own new FK points at). Runs on every `migrate`, including the
    test runner's fresh test database, which never runs entrypoint.sh's
    separate `manage.py seed_rbac` call - so this is what actually
    guarantees the bootstrap org is usable (has roles/permissions) right
    after migrating, not just in the dev/self-hosted container.

    Uses apps.get_model() (the historical, frozen-at-this-migration model
    state) throughout - not a live import of rbac.services - since a
    migration must never assume the *current* code's model classes match
    the DB schema at this exact point in migration history. rbac.catalogue's
    PERMISSION_CATALOGUE/ROLE_CATALOGUE are safe to import directly - plain
    data, no model references."""
    from rbac.catalogue import PERMISSION_CATALOGUE, ROLE_CATALOGUE

    Organization = apps.get_model("organization", "Organization")
    Permission = apps.get_model("rbac", "Permission")
    Role = apps.get_model("rbac", "Role")

    organization = Organization.objects.get(id=BOOTSTRAP_ORGANIZATION_ID)

    permissions_by_codename = {}
    for codename, description in PERMISSION_CATALOGUE:
        permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
        permissions_by_codename[codename] = permission

    for name, (description, codenames) in ROLE_CATALOGUE.items():
        role, _ = Role.objects.get_or_create(
            organization=organization, name=name, defaults={"description": description, "is_system": True}
        )
        role.permissions.add(*(permissions_by_codename[codename] for codename in codenames))


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("organization", "0005_organization_remove_organizationsettings_id_and_more"),
        ("rbac", "0002_role_organization_alter_role_name_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_bootstrap_rbac, noop_reverse),
    ]
