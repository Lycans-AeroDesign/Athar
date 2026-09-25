import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Drops the old Category FK now that 0004 has copied every value into
    component_category, and takes over its name."""

    dependencies = [
        ('knowledge', '0004_manual_populate_component_categories'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='component',
            name='category',
        ),
        migrations.RenameField(
            model_name='component',
            old_name='component_category',
            new_name='category',
        ),
        migrations.AlterField(
            model_name='component',
            name='category',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='components', to='knowledge.componentcategory'),
        ),
    ]
