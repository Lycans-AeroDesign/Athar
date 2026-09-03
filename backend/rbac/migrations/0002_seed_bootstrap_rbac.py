from django.db import migrations

BOOTSTRAP_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000"

# Starter category taxonomy - placeholder content, not schema. Swap these for
# whatever the team's real taxonomy is; there's no category-admin UI yet, so
# this is the only way to get the article editor's category picker populated
# out of the box for the bootstrap organization specifically (a self-service-
# created organization starts with none, and gets its own via its own admin
# creating them - this migration only ever runs once, at migrate time).
CATEGORIES = [
    ("Avionics", "avionics", "Flight computers, sensors, navigation, and electronics."),
    ("Structures", "structures", "Airframe, materials, and mechanical design."),
    ("Propulsion", "propulsion", "Motors, batteries, and powertrain."),
    ("Software", "software", "Ground control, autopilot, and tooling code."),
    ("Testing & QA", "testing-qa", "Test procedures, flight logs, and validation."),
    ("General", "general", "Anything that doesn't fit a more specific category."),
]


def seed_bootstrap_rbac_and_categories(apps, schema_editor):
    """Seeds the bootstrap Organization's RBAC catalogue and starter
    categories. Runs on every `migrate`, including the test runner's fresh
    test database - though backend/core/testing.py's create_test_organization
    seeds its own organization independently via live code
    (rbac.services.seed_rbac_for_organization) and never touches the
    bootstrap org, so this migration existing or not has no effect on the
    test suite either way. What it does guarantee is that a genuinely fresh
    install has a usable organization (roles + a starter category list)
    immediately after migrating, without needing to go through self-service
    signup first.

    Uses apps.get_model() (the historical, frozen-at-this-migration model
    state) throughout, not a live import of knowledge/rbac models - a
    migration must never assume the *current* code's model classes match the
    DB schema at this exact point in migration history. rbac.catalogue's
    PERMISSION_CATALOGUE/ROLE_CATALOGUE are safe to import directly - plain
    data, no model references."""
    from rbac.catalogue import PERMISSION_CATALOGUE, ROLE_CATALOGUE

    Organization = apps.get_model("organization", "Organization")
    Permission = apps.get_model("rbac", "Permission")
    Role = apps.get_model("rbac", "Role")
    Category = apps.get_model("knowledge", "Category")

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

    for name, slug, description in CATEGORIES:
        Category.objects.get_or_create(
            organization=organization, slug=slug, defaults={"name": name, "description": description}
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("rbac", "0001_initial"),
        ("organization", "0002_seed_bootstrap_organization"),
        ("knowledge", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_bootstrap_rbac_and_categories, noop_reverse),
    ]
