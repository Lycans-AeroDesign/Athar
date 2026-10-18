# Monitoring and alerting

What Athar reports when something goes wrong, and the alerts to set up so someone notices.

## Error tracking (Sentry, optional)

Off by default: with no `SENTRY_DSN` nothing leaves the server. To enable it, create a Sentry project (Python/Django) and set in `backend/.env`:

```
SENTRY_DSN=https://<key>@<host>/<project>
SENTRY_ENVIRONMENT=production      # optional; defaults to production, or development when DEBUG
SENTRY_TRACES_SAMPLE_RATE=0        # performance tracing off; raise deliberately
LOG_LEVEL=INFO
```

Restart `backend`, `celery-worker` and `celery-beat` so all three report. Unhandled exceptions and ERROR-level logs are sent. **Privacy:** request bodies, cookies, authorization headers and user identity/IP are never attached (`send_default_pii=False`, `max_request_body_size="never"`). Record the provider and region in your sub-processor list before enabling it.

The frontend does not report to Sentry yet; browser-side errors only show in the browser console.

## Alerts to create (in Sentry: Alerts > Create alert)

| Alert | Condition | Why |
|---|---|---|
| New issue | A new issue is created | Catch new bugs after a deploy |
| Regression | A resolved issue reappears | |
| Error spike | More than [10] events in 5 minutes | Outage or bad deploy |
| **Security signal** | An event whose logger is `athar.security` | A rotated refresh token was replayed, so sessions were revoked (possible cookie theft). Route to the incident lead. |
| Celery failures | Events from `celery-worker`/`celery-beat` (filter `server_name` or tag) | Backups and file clean-up run there |

Send them to [email / chat / pager].

## Uptime

The backend exposes a health check (`/api/v1/health/`); point an uptime monitor at the public site and API [provider] and alert on 2 consecutive failures. Also watch: database disk space, backup job status (Settings > Backups), and certificate expiry.

## Review the audit log, too

Settings > Audit log records administrative and account actions. Look for: `auth.refresh_reuse`, role or permission changes, `account.delete`, unexpected exports. IP address and browser are kept for 90 days.

## Incident handling

See [incident-response.md](../security/incident-response.md).
