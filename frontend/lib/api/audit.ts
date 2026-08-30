import { apiJson } from "./client";
import type { AuditLogEntry, Paginated } from "./types";

/** Full log - requires audit.read (admin-only), used by the Settings > Audit Log tab. */
export function getAuditLogs(page = 1): Promise<Paginated<AuditLogEntry>> {
  return apiJson<Paginated<AuditLogEntry>>(`/api/v1/audit/logs/?page=${page}`);
}

/** Public-to-the-org Knowledge activity feed (publish/submit/reject/archive/ask/
 * answer/accept/promote only) - just needs to be logged in, unlike getAuditLogs
 * above. Used by the Dashboard's "Recent Team Activity" widget. */
export function getKnowledgeActivity(page = 1): Promise<Paginated<AuditLogEntry>> {
  return apiJson<Paginated<AuditLogEntry>>(`/api/v1/audit/activity/?page=${page}`);
}
