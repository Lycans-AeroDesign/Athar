# Security incident response

How vulnerabilities and incidents are handled for an Athar instance. Reporting a vulnerability is covered in [SECURITY.md](../../SECURITY.md); this document is for the people who respond. Fill the `[brackets]` for your deployment and rehearse it once a year.

> Draft process, not legal advice. Breach-notification deadlines depend on the laws that apply to you; have counsel confirm them.

## Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | [name, backup name] | Owns the response, decides severity, keeps the timeline |
| Technical responder | [name] | Investigates, contains, fixes |
| Communications / privacy contact | [name] | Notifies users, customers and authorities |

Contact channels: [security email], private GitHub security advisory, [phone/chat for urgent].

## Severity

| Level | Examples | Target response |
|---|---|---|
| Critical | Cross-tenant data exposure, leaked secrets in use, confirmed account takeover at scale | Start within 1 hour |
| High | Single-tenant data exposure, auth bypass, refresh-token reuse alerts on admin accounts | Same day |
| Medium | Exploitable bug without evidence of exploitation | Within 3 days |
| Low | Hardening, theoretical issue | Normal backlog |

## Signals that start a response

- A vulnerability report through GitHub Security > Report a vulnerability.
- An error-tracking alert for `athar.security` ("Refresh token reuse detected") or an unusual burst of errors (see [monitoring](../operations/monitoring.md)).
- A CodeQL, Dependabot, secret-scan or image-scan finding rated high or critical.
- Audit-log entries that look wrong (`auth.refresh_reuse`, unexpected role or permission changes, exports or deletions).
- A user report of unexpected access.

## Procedure

1. **Triage (first hour).** Open a private record. Confirm it's real, assign a severity, name the incident lead, start a timestamped log of what is known and every action taken.
2. **Contain.** Choose the narrowest effective action:
   - Compromised account: block it (Settings > Users) and revoke its sessions (a blocked user can't refresh; refresh-token reuse already revokes all of a user's sessions).
   - Leaked secret: rotate it (`SECRET_KEY`/`JWT_SIGNING_KEY` invalidates all sessions, `BACKUP_ENCRYPTION_KEY`, database, SMTP and storage credentials) and redeploy.
   - Vulnerable code path: disable the feature or route at nginx, or ship a fix.
   - Suspected data exposure: preserve evidence first (logs, audit entries, database snapshot), then restrict access.
3. **Investigate.** Use the audit log (Settings > Audit log) to establish who did what, when, from which IP/user agent (kept 90 days), plus nginx and application logs. Determine which organizations and which data were affected, and whether it was accessed or only exposed.
4. **Eradicate and recover.** Fix the root cause, add a regression test (for tenant leaks, a route in `core/test_tenant_isolation.py`), redeploy, verify, and restore from a known-good encrypted backup if data was altered (restore is documented under Settings > Backups).
5. **Notify.** If personal data was affected, tell the affected organizations and users and, where the law requires, the regulator, within the deadlines counsel has confirmed `[hours]`. Say what happened, what data, what you've done, and what they should do (for example change passwords).
6. **Review (within 2 weeks).** Blameless write-up: timeline, root cause, what worked, what didn't, actions with owners and dates. Update this document and the monitoring rules.

## Evidence to keep

Alert/report text, the timeline, relevant log excerpts, audit-log entries, affected-account and organization lists, and the notifications sent. Store them privately and for as long as counsel advises.
