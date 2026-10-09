"""Publishes version 1 of the Privacy Policy and Confidentiality Agreement
for every organization that exists when this runs, so a fresh install starts
with them - every member must accept them before using the platform (see
policies/authentication.py). They're starting templates for a student
engineering team: admins review and adapt them in Settings > Policies, and
publishing an edit asks everyone to accept again.

An organization that already has a draft or version of a policy is left
alone for that policy. Organizations created later get the same policies
from organization.services.create_organization (policies.services.seed_default_policies).
"""

from django.db import migrations
from django.utils import timezone

from policies.defaults import DEFAULT_POLICIES


def seed_initial_policies(apps, schema_editor):
    Organization = apps.get_model("organization", "Organization")
    PolicyDraft = apps.get_model("policies", "PolicyDraft")
    PolicyVersion = apps.get_model("policies", "PolicyVersion")
    now = timezone.now()
    for organization in Organization.objects.all():
        for kind, title, content in DEFAULT_POLICIES:
            already_has_it = (
                PolicyDraft.objects.filter(organization=organization, kind=kind).exists()
                or PolicyVersion.objects.filter(organization=organization, kind=kind).exists()
            )
            if already_has_it:
                continue
            PolicyDraft.objects.create(organization=organization, kind=kind, title=title, content=content)
            PolicyVersion.objects.create(
                organization=organization,
                kind=kind,
                version=1,
                title=title,
                content=content,
                is_current=True,
                published_at=now,
            )


class Migration(migrations.Migration):

    dependencies = [
        ("policies", "0001_initial"),
        ("organization", "0004_uuid7_primary_keys"),
    ]

    operations = [
        # Reverse is a no-op: once members have accepted these, the versions
        # are the record of what they agreed to and shouldn't be deleted.
        migrations.RunPython(seed_initial_policies, migrations.RunPython.noop),
    ]
