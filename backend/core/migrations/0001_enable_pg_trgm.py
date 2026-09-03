from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Enables Postgres' pg_trgm extension - trigram similarity is what lets
    knowledge/search.py's full-text search still catch mid-word/typo matches
    (e.g. "ptor" finding "Processor") the way the old plain `icontains` did,
    since word-based full-text search alone only matches whole lexemes/
    prefixes. Lives in `core` (not `knowledge`) since it's a database-wide
    extension, not something owned by one app's models."""

    initial = True

    dependencies = []

    operations = [
        TrigramExtension(),
    ]
