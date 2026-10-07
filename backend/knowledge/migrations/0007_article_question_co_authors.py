from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('knowledge', '0006_uuid7_primary_keys'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='article',
            name='co_authors',
            field=models.ManyToManyField(blank=True, related_name='coauthored_articles', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='question',
            name='co_authors',
            field=models.ManyToManyField(blank=True, related_name='coauthored_questions', to=settings.AUTH_USER_MODEL),
        ),
    ]
