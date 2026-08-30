"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Pagination } from "@/components/ui/Pagination";
import { formatDateTime } from "@/lib/datetime";
import { getAuditLogs } from "@/lib/api/audit";
import type { AuditLogEntry, Paginated } from "@/lib/api/types";

// Rendered only when the viewer has audit.read (see settings/page.tsx) -
// that's also what GET /audit/logs/ itself requires. Read-only paged
// browsing (Pagination, not the "load more" pattern used by RolesSettingsForm/
// CategorySettingsForm) since there's no local editing happening here.
export function AuditLogSettingsForm() {
  const t = useTranslations("settings.audit");
  const commonT = useTranslations("common");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuditLogs(page)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [page]);

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
        <div className="p-6 pb-4">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
        </div>

        {error && (
          <p className="px-6 pb-4 font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        {!data ? (
          <p className="px-6 pb-6 font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : data.results.length === 0 ? (
          <p className="px-6 pb-6 font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-body-md text-body-md">
              <thead>
                <tr className="border-t border-outline-variant text-start">
                  <th className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant">
                    {t("actionColumn")}
                  </th>
                  <th className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant">
                    {t("targetColumn")}
                  </th>
                  <th className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant">
                    {t("actorColumn")}
                  </th>
                  <th className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant">
                    {t("timeColumn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((entry) => (
                  <tr key={entry.id} className="border-t border-outline-variant">
                    <td className="px-6 py-2.5 font-mono-sm text-mono-sm text-on-surface">{entry.action}</td>
                    <td className="px-6 py-2.5 text-on-surface-variant truncate max-w-[240px]">{entry.target_repr}</td>
                    <td className="px-6 py-2.5 text-on-surface-variant">{entry.actor_email ?? t("systemActor")}</td>
                    <td className="px-6 py-2.5 font-mono-sm text-mono-sm text-on-surface-variant whitespace-nowrap">
                      {formatDateTime(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.results.length > 0 && (
        <Pagination
          page={page}
          hasNext={data.next !== null}
          hasPrevious={data.previous !== null}
          onPageChange={setPage}
          totalCount={data.count}
        />
      )}
    </div>
  );
}
