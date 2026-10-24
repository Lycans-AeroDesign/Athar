from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0005_alter_courseresource_url'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='course',
            name='co_authors',
            field=models.ManyToManyField(blank=True, related_name='coauthored_courses', to=settings.AUTH_USER_MODEL),
        ),
    ]
