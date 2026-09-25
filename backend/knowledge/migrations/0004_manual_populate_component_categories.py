# Data-only step of the Component.category move (see 0003/0005) - kept in its
# own migration because Postgres refuses schema changes on a table with
# pending row updates in the same transaction.

from django.db import migrations, models


def copy_component_categories(apps, schema_editor):
    """Copies every knowledge Category that at least one component uses into
    a same-named ComponentCategory in that organization, and repoints the
    component at it. The original Category is left alone - articles/SOPs/
    documents may still use it."""
    Component = apps.get_model("knowledge", "Component")
    ComponentCategory = apps.get_model("knowledge", "ComponentCategory")
    copies = {}
    for component in Component.objects.exclude(category__isnull=True).select_related("category"):
        source = component.category
        key = (component.organization_id, source.pk)
        if key not in copies:
            copies[key], _ = ComponentCategory.objects.get_or_create(
                organization_id=component.organization_id,
                name=source.name,
                defaults={"slug": source.slug, "description": source.description},
            )
        component.component_category = copies[key]
        component.save(update_fields=["component_category"])


def backfill_updated_by(apps, schema_editor):
    Component = apps.get_model("knowledge", "Component")
    Component.objects.filter(updated_by__isnull=True).update(updated_by=models.F("created_by"))



class Migration(migrations.Migration):

    dependencies = [
        ('knowledge', '0003_component_inventory'),
    ]

    operations = [
        migrations.RunPython(copy_component_categories, migrations.RunPython.noop),
        migrations.RunPython(backfill_updated_by, migrations.RunPython.noop),
    ]
