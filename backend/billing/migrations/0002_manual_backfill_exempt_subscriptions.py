"""Every organization that exists before billing ships gets an exempt subscription, so turning
subscriptions on later never locks out an org that was never asked to pay."""

from django.db import migrations


def backfill(apps, schema_editor):
    Organization = apps.get_model("organization", "Organization")
    Subscription = apps.get_model("billing", "Subscription")
    existing = set(Subscription.objects.values_list("organization_id", flat=True))
    Subscription.objects.bulk_create(
        Subscription(organization_id=org_id, exempt=True)
        for org_id in Organization.objects.exclude(pk__in=existing).values_list("pk", flat=True)
    )


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0001_initial"),
        ("organization", "0007_share_links"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
