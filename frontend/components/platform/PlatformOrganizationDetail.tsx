"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { Link, getPathname } from "@/i18n/navigation";
import {
  sendPlatformPasswordResetLink,
  getPlatformOrganization,
  getPlatformOrganizationUsers,
  setPlatformOrganizationActive,
  setPlatformUserActive,
  type PlatformOrganization,
  type PlatformUser,
} from "@/lib/api/platform";
import type { Paginated } from "@/lib/api/types";
import { formatBytes } from "@/lib/bytes";
import { formatDate, formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

const USER_COLUMNS = ["userColumn", "rolesColumn", "statusColumn", "joinedColumn", "activityColumn", "actionsColumn"] as const;

export function PlatformOrganizationDetail({ id }: { id: string }) {
  const t = useTranslations("platform");
  const commonT = useTranslations("common");
  const locale = useLocale();

  const [org, setOrg] = useState<PlatformOrganization | null>(null);
  const [users, setUsers] = useState<Paginated<PlatformUser> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [orgConfirm, setOrgConfirm] = useState(false);
  const [userConfirm, setUserConfirm] = useState<PlatformUser | null>(null);
  const [resetTarget, setResetTarget] = useState<PlatformUser | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; sent: boolean } | null>(null);

  useEffect(() => {
    getPlatformOrganization(id)
      .then(setOrg)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  const loadUsers = useCallback(() => {
    getPlatformOrganizationUsers(id, page)
      .then(setUsers)
      .catch((err) => setError(errorMessage(err)));
  }, [id, page]);

  useEffect(loadUsers, [loadUsers]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const toggleOrg = () =>
    run(async () => {
      if (!org) return;
      setOrg(await setPlatformOrganizationActive(org.id, !org.is_active));
    });

  const toggleUser = () =>
    run(async () => {
      if (!userConfirm) return;
      await setPlatformUserActive(userConfirm.id, !userConfirm.is_active);
      setUserConfirm(null);
      loadUsers();
    });

  const generateLink = () =>
    run(async () => {
      if (!resetTarget) return;
      const path = getPathname({ href: "/reset-password", locale });
      const result = await sendPlatformPasswordResetLink(
        resetTarget.id,
        `${window.location.origin}${path}`,
        locale,
      );
      setResetResult({ email: result.email, sent: result.email_sent });
      setResetTarget(null);
    });

  return (
    <div className="space-y-6">
      <Link href="/platform" className="inline-flex items-center gap-1 text-primary hover:underline">
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {!org ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface">{org.name}</h1>
              <p className="font-mono-sm text-mono-sm text-on-surface-variant">
                {org.slug} · {t("createdOn", { date: formatDate(org.created_at) })}
              </p>
              {org.admin_emails.length > 0 && (
                <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                  {t("admins")}: {org.admin_emails.join(", ")}
                </p>
              )}
            </div>
            <Button variant={org.is_active ? "danger" : "primary"} onClick={() => setOrgConfirm(true)}>
              {org.is_active ? t("suspend") : t("reactivate")}
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={t("users")}
              value={org.user_count}
              icon="group"
              trend={t("activeCount", { count: org.active_user_count })}
            />
            <StatCard
              label={t("files")}
              value={formatBytes(org.file_bytes)}
              icon="folder"
              trend={t("fileCount", { count: org.file_count })}
            />
            <StatCard label={t("backups")} value={formatBytes(org.backup_bytes)} icon="backup" />
            <StatCard
              label={t("activityColumn")}
              value={org.last_activity ? formatRelativeTime(org.last_activity) : t("never")}
              icon="history"
            />
          </div>

          <div className="bg-surface rounded-xl border border-outline-variant p-6">
            <h2 className="font-headline-md text-headline-md text-on-surface mb-1">{t("contentCounts")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-4">{t("contentCountsNote")}</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Object.entries(org.content_counts).map(([key, value]) => (
                <div key={key}>
                  <dt className="font-body-md text-body-md text-on-surface-variant">{t(`counts.${key}`)}</dt>
                  <dd className="font-headline-md text-headline-md text-on-surface">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      <div className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
        <h2 className="p-6 pb-4 font-headline-md text-headline-md text-on-surface">{t("users")}</h2>
        {!users ? (
          <p className="px-6 pb-6 font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-body-md text-body-md">
              <thead>
                <tr className="border-t border-outline-variant">
                  {USER_COLUMNS.map((key, index) => (
                    <th
                      key={index}
                      className="px-6 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant"
                    >
                      {key === "actionsColumn" ? <span className="sr-only">{t(key)}</span> : t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.results.map((user) => (
                  <tr key={user.id} className="border-t border-outline-variant">
                    <td className="px-6 py-2.5">
                      <div className="text-on-surface">{user.email}</div>
                      <div className="text-on-surface-variant">
                        {[user.first_name, user.last_name].filter(Boolean).join(" ")}
                      </div>
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant">
                      {[...user.roles, ...(user.is_superuser ? [t("platformAdmin")] : [])].join(", ")}
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant">
                      {user.is_active ? t("statusActive") : t("statusBlocked")}
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant whitespace-nowrap">
                      {formatDate(user.date_joined)}
                    </td>
                    <td className="px-6 py-2.5 text-on-surface-variant whitespace-nowrap">
                      {user.last_activity ? formatRelativeTime(user.last_activity) : t("never")}
                    </td>
                    <td className="px-6 py-2.5 text-end whitespace-nowrap">
                      {!user.is_superuser && (
                        <div className="flex justify-end gap-2">
                          {user.is_active && (
                            <Button variant="secondary" onClick={() => setResetTarget(user)}>
                              {t("resetLink")}
                            </Button>
                          )}
                          <Button
                            variant={user.is_active ? "secondary" : "primary"}
                            onClick={() => setUserConfirm(user)}
                          >
                            {user.is_active ? t("block") : t("unblock")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {users && users.count > users.results.length && (
        <Pagination
          page={page}
          hasNext={users.next !== null}
          hasPrevious={users.previous !== null}
          onPageChange={setPage}
          totalCount={users.count}
        />
      )}

      <ConfirmModal
        open={orgConfirm}
        onOpenChange={setOrgConfirm}
        danger={org?.is_active}
        title={org?.is_active ? t("suspendTitle") : t("reactivateTitle")}
        description={t(org?.is_active ? "suspendBody" : "reactivateBody", { name: org?.name ?? "" })}
        confirmLabel={org?.is_active ? t("suspend") : t("reactivate")}
        onConfirm={toggleOrg}
      />
      <ConfirmModal
        open={userConfirm !== null}
        onOpenChange={(open) => !open && setUserConfirm(null)}
        danger={userConfirm?.is_active}
        title={userConfirm?.is_active ? t("blockTitle") : t("unblockTitle")}
        description={t(userConfirm?.is_active ? "blockBody" : "unblockBody", { email: userConfirm?.email ?? "" })}
        confirmLabel={userConfirm?.is_active ? t("block") : t("unblock")}
        onConfirm={toggleUser}
      />
      <ConfirmModal
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={t("resetLinkTitle")}
        description={t("resetLinkConfirmBody", { email: resetTarget?.email ?? "" })}
        confirmLabel={t("resetLink")}
        onConfirm={generateLink}
      />
      <Modal
        open={resetResult !== null}
        onOpenChange={(open) => !open && setResetResult(null)}
        title={t("resetLinkTitle")}
        footer={
          <Button variant="secondary" onClick={() => setResetResult(null)}>
            {t("done")}
          </Button>
        }
      >
        {resetResult && (
          <p className="font-body-md text-body-md text-on-surface">
            {resetResult.sent
              ? t("resetLinkEmailSent", { email: resetResult.email })
              : t("resetLinkEmailFailed", { email: resetResult.email })}
          </p>
        )}
      </Modal>
    </div>
  );
}
