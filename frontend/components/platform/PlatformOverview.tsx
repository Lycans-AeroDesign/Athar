"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Pagination } from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Switch } from "@/components/ui/Switch";
import { Link } from "@/i18n/navigation";
import {
  getPlatformOrganizations,
  getPlatformSettings,
  getPlatformSummary,
  updatePlatformSettings,
  type PlatformOrganization,
  type PlatformSettings,
  type PlatformSummary,
} from "@/lib/api/platform";
import type { Paginated } from "@/lib/api/types";
import { formatBytes } from "@/lib/bytes";
import { formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

const COLUMNS = ["nameColumn", "statusColumn", "usersColumn", "storageColumn", "activityColumn"] as const;

// Instance-operator dashboard: per-organization administrative stats only (counts, sizes,
// activity timestamps), never organization content. The backend enforces is_superuser.
export function PlatformOverview() {
  const t = useTranslations("platform");

  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [data, setData] = useState<Paginated<PlatformOrganization> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    getPlatformSettings()
      .then(setPlatformSettings)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function handleToggleRegistration(enabled: boolean) {
    setIsSavingSettings(true);
    setError(null);
    try {
      setPlatformSettings(await updatePlatformSettings({ organization_registration_enabled: enabled }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  }

  useEffect(() => {
    getPlatformSummary()
      .then(setSummary)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    const handle = setTimeout(
      () => {
        getPlatformOrganizations(page, search.trim())
          .then(setData)
          .catch((err) => setError(errorMessage(err)));
      },
      search ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [page, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">{t("title")}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={t("organizations")}
            value={summary.organization_count}
            icon="domain"
            trend={t("activeCount", { count: summary.active_organization_count })}
          />
          <StatCard
            label={t("users")}
            value={summary.user_count}
            icon="group"
            trend={t("activeCount", { count: summary.active_user_count })}
          />
          <StatCard label={t("files")} value={formatBytes(summary.file_bytes)} icon="folder" />
          <StatCard label={t("backups")} value={formatBytes(summary.backup_bytes)} icon="backup" />
        </div>
      )}

      {platformSettings && (
        <div className="bg-surface rounded-xl border border-outline-variant p-6">
          <Switch
            checked={platformSettings.organization_registration_enabled}
            disabled={isSavingSettings}
            onChange={handleToggleRegistration}
            label={t("registrationLabel")}
            description={t("registrationDescription")}
          />
        </div>
      )}

      <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
        <div className="p-6 pb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("organizations")}</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="px-3 py-2 w-64 max-w-full font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg outline-none focus:border-primary"
          />
        </div>

        {!data ? (
          <div className="p-6 pt-0">
            <TableSkeleton rows={5} columns={5} />
          </div>
        ) : data.results.length === 0 ? (
          <p className="px-6 pb-6 font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-body-md text-body-md">
              <thead>
                <tr className="border-t border-outline-variant">
                  {COLUMNS.map((key) => (
                    <th
                      key={key}
                      className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant"
                    >
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((org) => (
                  <tr key={org.id} className="border-t border-outline-variant">
                    <td className="px-6 py-2.5">
                      <Link href={`/platform/${org.id}`} className="text-primary font-bold hover:underline">
                        {org.name}
                      </Link>
                      <div className="font-mono-sm text-mono-sm text-on-surface-variant">{org.slug}</div>
                    </td>
                    <td className="px-6 py-2.5">
                      <span
                        className={
                          org.is_active
                            ? "rounded-full px-2 py-0.5 bg-secondary-container text-on-secondary-container"
                            : "rounded-full px-2 py-0.5 bg-error-container text-on-error-container"
                        }
                      >
                        {org.is_active ? t("statusActive") : t("statusSuspended")}
                      </span>
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant">
                      {org.active_user_count} / {org.user_count}
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant whitespace-nowrap">
                      {formatBytes(org.total_bytes)}
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant whitespace-nowrap">
                      {org.last_activity ? formatRelativeTime(org.last_activity) : t("never")}
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
