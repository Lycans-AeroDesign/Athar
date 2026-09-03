from django.db import migrations


def convert_organization_to_public(apps, schema_editor):
    """The ORGANIZATION visibility value is being removed from the Visibility
    enum (it enforced identically to PUBLIC - see models.py's updated
    Visibility docstring) - this rewrites any existing rows so no data is
    silently left holding a value the app no longer recognizes."""
    for model_name in ("Article", "Question", "Document"):
        model = apps.get_model("knowledge", model_name)
        model.objects.filter(visibility="ORGANIZATION").update(visibility="PUBLIC")


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0009_article_organization_category_organization_and_more"),
    ]

    operations = [
        migrations.RunPython(convert_organization_to_public, migrations.RunPython.noop),
    ]
