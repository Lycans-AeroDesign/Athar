from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('knowledge', '0009_collection_collectionitem_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='sop',
            name='co_authors',
            field=models.ManyToManyField(blank=True, related_name='coauthored_sops', to=settings.AUTH_USER_MODEL),
        ),
    ]
