"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { IconRowListSkeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { getTrash, purgeFromTrash, restoreFromTrash } from "@/lib/api/trash";
import type { TrashedItem, TrashType } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";
import { formatPersonName } from "@/lib/format";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

type Tab = TrashType | "all";

const TABS: Tab[] = [
  "all",
  "article",
  "question",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
  "course",
];

const TYPE_ICON: Record<TrashType, string> = { ...RELATABLE_ICON, course: "school" };
const TYPE_ROUTE: Record<TrashType, string> = { ...RELATABLE_ROUTE_PREFIX, course: "/training/courses" };

export default function TrashPage() {
  const t = useTranslations("trashPage");
  const canPurge = useHasPermission("trash.purge");
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ key: string; items: TrashedItem[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashedItem | null>(null);
  const [restored, setRestored] = useState<TrashedItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resultKey = `${tab}:${page}`;
  const items = result?.key === resultKey ? result.items : null;

  useEffect(() => {
    getTrash(tab === "all" ? undefined : tab, page)
      .then((data) =>
        setResult({ key: resultKey, items: data.results, hasNext: data.next !== null, count: data.count }),
      )
      .catch((err) => setError(errorMessage(err)));
  }, [tab, page, resultKey]);

  function selectTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  function dropItem(item: TrashedItem) {
    setResult((prev) => (prev ? { ...prev, items: prev.items.filter((entry) => entry.id !== item.id) } : prev));
  }

  async function handleRestore(item: TrashedItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await restoreFromTrash(item.type, item.id);
      dropItem(item);
      setRestored(item);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge() {
    if (!purging) return;
    setError(null);
    try {
      await purgeFromTrash(purging.type, purging.id);
      dropItem(purging);
      setRestored(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>
      </div>

      <div className="border-b border-outline-variant">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => selectTab(value)}
              className={`flex items-center gap-1.5 px-4 py-2 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
                tab === value
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface"
              }`}
            >
              {value !== "all" && <Icon name={TYPE_ICON[value]} size={16} />}
              {t(`tab_${value}`)}
            </button>
          ))}
        </div>
      </div>

      {restored && (
        <p className="flex flex-wrap items-center gap-2 font-body-md text-body-md text-on-surface" role="status">
          <Icon name="check_circle" size={18} className="text-primary" />
          {t("restored", { title: restored.title })}
          <Link href={`${TYPE_ROUTE[restored.type]}/${restored.id}`} className="text-primary hover:underline">
            {t("open")}
          </Link>
        </p>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        !error && <IconRowListSkeleton rows={5} trailingIcon />
      ) : items.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={`${item.type}:${item.id}`}
              className="flex flex-wrap items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl p-4"
            >
              <Icon name={TYPE_ICON[item.type]} size={20} className="text-on-surface-variant shrink-0" />
              <div className="flex-1 min-w-48">
                <p className="font-body-md text-body-md text-on-surface truncate">{item.title}</p>
                <p className="font-mono-sm text-mono-sm text-on-surface-variant">
                  {t("deletedBy", {
                    name: (item.deleted_by && formatPersonName(item.deleted_by)) || t("someone"),
                    date: formatDateTime(item.deleted_at),
                  })}
                  {" · "}
                  {t("purgeOn", { date: formatDate(item.purge_at) })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="secondary" size="sm" loading={busyId === item.id} onClick={() => handleRestore(item)}>
                  <Icon name="undo" size={16} />
                  {t("restore")}
                </Button>
                {canPurge && (
                  <Button variant="danger" size="sm" onClick={() => setPurging(item)}>
                    {t("deleteForever")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {items && items.length > 0 && (
        <Pagination
          page={page}
          hasNext={result?.hasNext ?? false}
          hasPrevious={page > 1}
          onPageChange={setPage}
          totalCount={result?.count}
        />
      )}

      <ConfirmModal
        open={purging !== null}
        onOpenChange={(open) => !open && setPurging(null)}
        title={t("purgeConfirmTitle")}
        description={t("purgeConfirmBody", { title: purging?.title ?? "" })}
        confirmLabel={t("deleteForever")}
        danger
        onConfirm={handlePurge}
      />
    </div>
  );
}
