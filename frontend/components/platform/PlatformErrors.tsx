"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { LoadError } from "@/components/ui/LoadError";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import {
  getPlatformErrors,
  type PlatformError,
  type PlatformErrorSource,
  type PlatformErrorStatus,
} from "@/lib/api/platform";
import type { Paginated } from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

const SELECT_CLASS = `${INPUT_CLASS} sm:w-auto`;

// Platform-admin error log: backend exceptions/ERROR logs and browser-reported errors,
// grouped so each row is one distinct bug (see backend platform_admin/error_log.py).
export function PlatformErrors() {
  const t = useTranslations("platform.errors");

  const [data, setData] = useState<Paginated<PlatformError> | null>(null);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<PlatformErrorSource | "">("");
  const [status, setStatus] = useState<PlatformErrorStatus>("open");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const handle = setTimeout(
      () => {
        setError(null);
        getPlatformErrors(page, { source, status, search: search.trim() })
          .then(setData)
          .catch((err) => setError(errorMessage(err)));
      },
      search ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [page, source, status, search, reloadKey]);

  function filterChanged<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  return (
    <div className="space-y-6">
      <Link href="/platform" className="inline-flex items-center gap-1 text-primary hover:underline">
        <Icon name="arrow_back" size={16} />
        {t("backToPlatform")}
      </Link>

      <div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">{t("title")}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => filterChanged(setSearch)(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className={`${INPUT_CLASS} sm:flex-1 sm:min-w-56`}
          />
          <div className="grid grid-cols-2 sm:flex gap-3">
            <select
              value={status}
              onChange={(e) => filterChanged(setStatus)(e.target.value as PlatformErrorStatus)}
              aria-label={t("statusFilter")}
              className={SELECT_CLASS}
            >
              <option value="open">{t("statusOpen")}</option>
              <option value="resolved">{t("statusResolved")}</option>
              <option value="all">{t("statusAll")}</option>
            </select>
            <select
              value={source}
              onChange={(e) => filterChanged(setSource)(e.target.value as PlatformErrorSource | "")}
              aria-label={t("sourceFilter")}
              className={SELECT_CLASS}
            >
              <option value="">{t("sourceAll")}</option>
              <option value="backend">{t("sourceBackend")}</option>
              <option value="frontend">{t("sourceFrontend")}</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="px-4 sm:px-6 pb-6">
            <LoadError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
          </div>
        ) : !data ? (
          <ul role="status" aria-busy="true">
            {Array.from({ length: 5 }).map((_, idx) => (
              <li key={idx} className="border-t border-outline-variant px-4 sm:px-6 py-3 space-y-2">
                <SkeletonText width="w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </li>
            ))}
          </ul>
        ) : data.results.length === 0 ? (
          <p className="px-4 sm:px-6 pb-6 font-body-md text-body-md text-on-surface-variant">
            {status === "open" ? t("emptyOpen") : t("empty")}
          </p>
        ) : (
          <ul>
            {data.results.map((item) => (
              <li key={item.id} className="border-t border-outline-variant">
                <Link
                  href={`/platform/errors/${item.id}`}
                  className="block px-4 sm:px-6 py-3 hover:bg-surface-container-low focus-visible:bg-surface-container-low outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-body-md text-body-md text-on-surface line-clamp-2 [overflow-wrap:anywhere]">
                      {item.exception_type && <span className="font-bold">{item.exception_type}: </span>}
                      {item.message}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 bg-surface-container-high font-mono-sm text-mono-sm text-on-surface"
                      title={t("occurrences", { count: item.count })}
                    >
                      ×{item.count}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-sm text-mono-sm text-on-surface-variant">
                    <SourceBadge source={item.source} />
                    {item.resolved_at && (
                      <span className="rounded-full px-2 py-0.5 bg-secondary-container text-on-secondary-container">
                        {t("resolvedBadge")}
                      </span>
                    )}
                    <span>{t("lastSeen", { time: formatRelativeTime(item.last_seen) })}</span>
                    {item.path && (
                      <span className="min-w-0 max-w-full truncate" dir="ltr">
                        {item.method ? `${item.method} ` : ""}
                        {item.path}
                      </span>
                    )}
                    {item.organization_name && <span className="min-w-0 truncate">{item.organization_name}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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

export function SourceBadge({ source }: { source: PlatformErrorSource }) {
  const t = useTranslations("platform.errors");
  return (
    <span
      className={
        source === "backend"
          ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-error-container text-on-error-container"
          : "inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-tertiary-container text-on-tertiary-container"
      }
    >
      <Icon name={source === "backend" ? "dns" : "computer"} size={14} />
      {source === "backend" ? t("sourceBackend") : t("sourceFrontend")}
    </span>
  );
}
