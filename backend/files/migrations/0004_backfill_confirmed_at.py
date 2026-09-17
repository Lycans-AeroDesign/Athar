# Backfills confirmed_at on every StoredFile that predates that field -
# without this, the delete_unconfirmed_files sweep (see files/tasks.py)
# would treat every already-in-use file (logos, avatars, attachments, ...)
# uploaded before this migration as an abandoned upload and delete it once
# its 24h grace period elapsed. Stamped with each row's own created_at, not
# now(), so ordering/auditing stays meaningful.

from django.db import migrations, models


def backfill_confirmed_at(apps, schema_editor):
    StoredFile = apps.get_model("files", "StoredFile")
    StoredFile.objects.filter(confirmed_at__isnull=True).update(confirmed_at=models.F("created_at"))


def noop_reverse(apps, schema_editor):
    # Nothing to undo - unconfirming every file on a rollback would make the
    # sweep immediately eligible to delete all of them once re-applied.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('files', '0003_storedfile_confirmed_at'),
    ]

    operations = [
        migrations.RunPython(backfill_confirmed_at, noop_reverse),
    ]
