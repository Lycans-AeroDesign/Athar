from django.db import models

from .models import AuditLog


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_action(
    actor,
    action: str,
    target: models.Model | None = None,
    metadata: dict | None = None,
    request=None,
) -> AuditLog:
    entry = AuditLog(
        actor=actor if actor and getattr(actor, "is_authenticated", False) else None,
        action=action,
        target=target,
        target_repr=str(target) if target is not None else "",
        metadata=metadata or {},
    )
    if request is not None:
        entry.ip_address = _client_ip(request)
        entry.user_agent = request.META.get("HTTP_USER_AGENT", "")
    entry.save()
    return entry
