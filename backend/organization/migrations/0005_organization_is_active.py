from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('organization', '0004_uuid7_primary_keys'),
    ]

    operations = [
        migrations.AddField(
            model_name='organization',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
    ]
