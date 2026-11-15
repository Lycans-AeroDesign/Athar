"""Instance error log: backend errors (any ERROR-level log record, which covers unhandled
request exceptions via `django.request` and failed Celery tasks via `celery.app.trace`) and
errors the browser reports (views.ErrorReportView) are stored as ErrorEvent rows for the
platform admin's error page.

Repeats are grouped by a fingerprint of where the error happened, not of its exact text, so
one bug firing a thousand times is one row with count=1000 rather than a thousand rows.
"""

import hashlib
import logging
import re
import threading
import traceback as traceback_module

from django.db import IntegrityError, connection, transaction
from django.db.models import F
from django.utils import timezone

MAX_MESSAGE = 4000
MAX_TRACEBACK = 50_000

# Bots probing with a bad Host header log this at ERROR on every request - noise, not a bug.
IGNORED_LOGGERS = ("django.security.DisallowedHost",)

# Digits, hex runs and UUIDs differ between occurrences of the same bug (ids, line:col in a
# minified bundle, memory addresses) - drop them before hashing so those occurrences group.
_VOLATILE = re.compile(r"0x[0-9a-fA-F]+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}|\d+")

_state = threading.local()


def _fingerprint(source: str, logger: str, exception_type: str, message: str, traceback: str) -> str:
    # With a traceback, where it happened identifies the bug better than the message (which
    # often embeds values); without one, the message is all there is.
    frames = "\n".join(
        line.strip() for line in traceback.splitlines() if (line.strip().startswith(("File ", "at ")) or "@" in line)
    )
    basis = "\x1f".join([source, logger, exception_type, frames or message[:500]])
    return hashlib.sha256(_VOLATILE.sub("N", basis).encode()).hexdigest()


def record_error(
    *,
    source: str,
    message: str,
    exception_type: str = "",
    traceback: str = "",
    level: str = "ERROR",
    logger: str = "",
    method: str = "",
    path: str = "",
    user_agent: str = "",
    user=None,
):
    """Store one occurrence. Never raises: a failure to record an error must not turn into a
    second error for whoever hit the first one."""
    from .models import ErrorEvent

    message = (message or "").strip()[:MAX_MESSAGE] or "(no message)"
    traceback = (traceback or "")[-MAX_TRACEBACK:]
    exception_type = exception_type[:200]
    user = user if getattr(user, "is_authenticated", False) else None
    details = {
        "level": level[:10],
        "logger": logger[:200],
        "exception_type": exception_type,
        "message": message,
        "traceback": traceback,
        "method": method[:10],
        "path": path.split("?", 1)[0].split("#", 1)[0][:500],
        "user_agent": user_agent[:300],
        "user": user,
        "organization_id": getattr(user, "organization_id", None),
    }
    fingerprint = _fingerprint(source, logger, exception_type, message, traceback)
    now = timezone.now()

    def bump() -> int:
        # A recurrence reopens a resolved error - the fix didn't hold.
        return ErrorEvent.objects.filter(fingerprint=fingerprint).update(
            count=F("count") + 1, last_seen=now, resolved_at=None, **details
        )

    try:
        if bump():
            return
        try:
            with transaction.atomic():
                ErrorEvent.objects.create(
                    source=source, fingerprint=fingerprint, first_seen=now, last_seen=now, **details
                )
        except IntegrityError:
            bump()  # Another process created the same group first.
    except Exception:  # noqa: BLE001 - see docstring
        pass


class DatabaseErrorHandler(logging.Handler):
    """LOGGING handler (config/settings.py) that stores ERROR+ records via record_error."""

    def emit(self, record: logging.LogRecord) -> None:
        if record.name.startswith(IGNORED_LOGGERS) or getattr(_state, "active", False):
            return
        # A write on a connection whose transaction is already broken would fail anyway.
        if connection.in_atomic_block and connection.needs_rollback:
            return
        _state.active = True  # Errors logged while saving this one aren't recorded (no loop).
        try:
            exception_type = ""
            traceback = ""
            if record.exc_info and record.exc_info[0] is not None:
                exception_type = record.exc_info[0].__name__
                traceback = "".join(traceback_module.format_exception(*record.exc_info))
            elif record.stack_info:
                traceback = record.stack_info
            request = getattr(record, "request", None)
            record_error(
                source="backend",
                message=record.getMessage(),
                exception_type=exception_type,
                traceback=traceback,
                level=record.levelname,
                logger=record.name,
                method=getattr(request, "method", "") or "",
                path=getattr(request, "path", "") or "",
                user_agent=(getattr(request, "META", {}) or {}).get("HTTP_USER_AGENT", "") if request else "",
                user=getattr(request, "user", None),
            )
        except Exception:  # noqa: BLE001
            pass
        finally:
            _state.active = False
