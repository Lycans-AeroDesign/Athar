# Starter category taxonomy - placeholder content, not schema. Swap these
# for whatever the team's real taxonomy is; there's no category-admin UI yet
# (see knowledge app's Phase 1 plan), so this is the only way to get the
# article editor's category picker populated out of the box.
from django.db import migrations

CATEGORIES = [
    ("Avionics", "avionics", "Flight computers, sensors, navigation, and electronics."),
    ("Structures", "structures", "Airframe, materials, and mechanical design."),
    ("Propulsion", "propulsion", "Motors, batteries, and powertrain."),
    ("Software", "software", "Ground control, autopilot, and tooling code."),
    ("Testing & QA", "testing-qa", "Test procedures, flight logs, and validation."),
    ("General", "general", "Anything that doesn't fit a more specific category."),
]


def seed_categories(apps, schema_editor):
    Category = apps.get_model("knowledge", "Category")
    for name, slug, description in CATEGORIES:
        Category.objects.get_or_create(slug=slug, defaults={"name": name, "description": description})


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_categories, migrations.RunPython.noop),
    ]
