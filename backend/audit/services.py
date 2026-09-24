import ipaddress

from django.db import models

from .models import AuditLog


def _client_ip(request) -> str | None:
    """The address nginx saw the request come from - the *last*
    X-Forwarded-For entry, matching DRF's NUM_PROXIES=1 (see
    config/settings.py). nginx overwrites that header with $remote_addr
    (see nginx/templates/locations.inc.template); the first entry is
    whatever the client claimed, so trusting it would let anyone forge the
    audit trail's IP. Anything that doesn't parse as an IP is dropped
    rather than saved - GenericIPAddressField would otherwise 500 the
    whole request (login included) on a malformed header."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    candidate = forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR")
    try:
        return str(ipaddress.ip_address(candidate)) if candidate else None
    except ValueError:
        return None


def log_action(
    actor,
    action: str,
    target: models.Model | None = None,
    metadata: dict | None = None,
    request=None,
    organization=None,
) -> AuditLog:
    """`organization` defaults to actor.organization - only pass it
    explicitly for the rare case where the actor is None/anonymous but the
    org is still known from context (e.g. accounts.services.register_user,
    which logs with actor=None since the user didn't exist yet at the start
    of that call, but already knows which org they're joining)."""
    is_authenticated = actor and getattr(actor, "is_authenticated", False)
    entry = AuditLog(
        organization=organization or (actor.organization if is_authenticated else None),
        actor=actor if is_authenticated else None,
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
