from django.db import migrations


def mask(code: str) -> str:
    return f"••••{code[-4:]}"


def mask_audit_log_invitation_codes(apps, schema_editor):
    """Older audit rows stored invitation codes in plaintext - in
    user.register's metadata and as invitation.create/revoke's target_repr.
    Codes can be reused (max_uses > 1) so those are still live secrets."""
    AuditLog = apps.get_model("audit", "AuditLog")
    for log in AuditLog.objects.filter(action="user.register", metadata__has_key="invitation_code").iterator():
        code = log.metadata.get("invitation_code")
        if isinstance(code, str) and not code.startswith("••••"):
            log.metadata["invitation_code"] = mask(code)
            log.save(update_fields=["metadata"])
    for log in AuditLog.objects.filter(action__startswith="invitation.").exclude(target_repr="").iterator():
        if not log.target_repr.startswith("••••"):
            log.target_repr = mask(log.target_repr)
            log.save(update_fields=["target_repr"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_user_email_visible"),
        ("audit", "0003_uuid7_primary_keys"),
    ]

    operations = [migrations.RunPython(mask_audit_log_invitation_codes, migrations.RunPython.noop)]
