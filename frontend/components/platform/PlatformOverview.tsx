"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { SubscriptionStatusBadge } from "@/components/billing/SubscriptionStatusBadge";
import { Icon } from "@/components/ui/Icon";
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
import { formatDate, formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

import { PlatformBillingSettings } from "./PlatformBillingSettings";

const COLUMNS = [
  "nameColumn",
  "statusColumn",
  "subscriptionColumn",
  "usersColumn",
  "storageColumn",
  "activityColumn",
] as const;

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{t("title")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
        </div>
        <Link
          href="/platform/errors"
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-4 py-2 font-label-caps text-label-caps text-on-surface hover:bg-surface-variant"
        >
          <Icon name="bug_report" size={18} />
          {t("errors.title")}
          {summary != null && summary.open_error_count > 0 && (
            <span className="rounded-full bg-error px-2 py-0.5 text-on-error">{summary.open_error_count}</span>
          )}
        </Link>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
          {summary.disk_total_bytes != null && summary.disk_used_bytes != null ? (
            <StatCard
              label={t("diskUsage")}
              value={t("diskUsedOfTotal", {
                used: formatBytes(summary.disk_used_bytes),
                total: formatBytes(summary.disk_total_bytes),
              })}
              icon="hard_drive"
              className="col-span-2 lg:col-span-1"
              trend={
                summary.disk_total_bytes > 0
                  ? t("diskPercentUsed", {
                      percent: Math.round((summary.disk_used_bytes / summary.disk_total_bytes) * 100),
                    })
                  : undefined
              }
            />
          ) : (
            <StatCard
              label={t("diskUsage")}
              value={t("diskUnavailable")}
              icon="hard_drive"
              className="col-span-2 lg:col-span-1"
            />
          )}
        </div>
      )}

      {platformSettings && (
        <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6">
          <Switch
            checked={platformSettings.organization_registration_enabled}
            disabled={isSavingSettings}
            onChange={handleToggleRegistration}
            label={t("registrationLabel")}
            description={t("registrationDescription")}
          />
        </div>
      )}

      {platformSettings && <PlatformBillingSettings settings={platformSettings} onUpdate={setPlatformSettings} />}

      <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
        <div className="p-4 sm:p-6 pb-4 sm:pb-4 flex flex-wrap items-center justify-between gap-3">
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
            className="px-3 py-2 w-full sm:w-64 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg outline-none focus:border-primary"
          />
        </div>

        {!data ? (
          <TableSkeleton variant="flush" rows={5} columns={["two-line", "pill", "pill", "text", "text", "text"]} />
        ) : data.results.length === 0 ? (
          <p className="px-4 sm:px-6 pb-6 font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <>
            {/* Phones: one card per organization instead of a five-column table that
              would need sideways scrolling. */}
            <ul className="md:hidden">
              {data.results.map((org) => (
                <li key={org.id} className="border-t border-outline-variant px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/platform/${org.id}`} className="text-primary font-bold hover:underline break-words">
                        {org.name}
                      </Link>
                      <div className="font-mono-sm text-mono-sm text-on-surface-variant break-all">{org.slug}</div>
                    </div>
                    <StatusPill
                      active={org.is_active}
                      label={org.is_active ? t("statusActive") : t("statusSuspended")}
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-body-md text-body-md">
                    <dt className="text-on-surface-variant">{t("subscriptionColumn")}</dt>
                    <dd className="text-end">
                      <SubscriptionCell org={org} />
                    </dd>
                    <dt className="text-on-surface-variant">{t("usersColumn")}</dt>
                    <dd className="text-on-surface text-end">
                      {org.active_user_count} / {org.user_count}
                    </dd>
                    <dt className="text-on-surface-variant">{t("storageColumn")}</dt>
                    <dd className="text-on-surface text-end">{formatBytes(org.total_bytes)}</dd>
                    <dt className="text-on-surface-variant">{t("activityColumn")}</dt>
                    <dd className="text-on-surface text-end">
                      {org.last_activity ? formatRelativeTime(org.last_activity) : t("never")}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
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
                        <StatusPill
                          active={org.is_active}
                          label={org.is_active ? t("statusActive") : t("statusSuspended")}
                        />
                      </td>
                      <td className="px-6 py-2.5">
                        <SubscriptionCell org={org} />
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
          </>
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

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={
        active
          ? "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 bg-secondary-container text-on-secondary-container"
          : "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 bg-error-container text-on-error-container"
      }
    >
      {label}
    </span>
  );
}

function SubscriptionCell({ org }: { org: PlatformOrganization }) {
  const { status, access_until } = org.subscription;
  return (
    <span className="inline-flex flex-col items-end md:items-start gap-0.5">
      <SubscriptionStatusBadge status={status} />
      {access_until && (
        <span className="font-body-md text-body-md text-on-surface-variant whitespace-nowrap">
          {formatDate(access_until)}
        </span>
      )}
    </span>
  );
}
