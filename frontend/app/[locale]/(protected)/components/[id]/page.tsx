"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Attachments } from "@/components/knowledge/Attachments";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteComponent, getComponent } from "@/lib/api/engineering";
import type { ComponentDetail, ComponentStatus } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

const STATUS_CLASSES: Record<ComponentStatus, string> = {
  CERTIFIED: "bg-primary-container text-on-primary-container",
  TESTING: "bg-tertiary-container text-on-tertiary-container",
  DEPRECATED: "bg-error-container text-on-error-container",
};

export default function ComponentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.component");
  const statusT = useTranslations("engineering.componentStatus");
  const router = useRouter();
  const canUpdate = useHasPermission("component.update");
  const canDelete = useHasPermission("component.delete");

  const [component, setComponent] = useState<ComponentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getComponent(id).then(setComponent, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!component) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteComponent(component!.id);
      router.push("/components");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/components"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {component.category && (
              <span className="font-label-caps text-label-caps text-primary uppercase">{component.category.name}</span>
            )}
            <span
              className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[component.status]}`}
            >
              {statusT(component.status)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canUpdate && (
              <Link href={`/components/${component.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canDelete && (
              <IconButton
                icon="delete"
                variant="danger"
                aria-label={t("deleteButton")}
                onClick={() => setDeleteOpen(true)}
              />
            )}
          </div>
        </div>
        <h1 className="font-display text-display text-on-surface">{component.name}</h1>
        {(component.manufacturer || component.part_number) && (
          <p className="font-body-md text-body-md text-on-surface-variant">
            {[component.manufacturer, component.part_number].filter(Boolean).join(" · ")}
          </p>
        )}
        {component.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {component.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-label-caps text-label-caps uppercase border border-outline-variant"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {component.summary ? (
        <Markdown content={component.summary} />
      ) : (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noSummary")}</p>
      )}

      {component.specifications.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
          <div className="bg-surface-container-low px-4 py-2 border-b border-outline-variant">
            <span className="font-label-caps text-label-caps text-on-surface uppercase">{t("specificationsTitle")}</span>
          </div>
          <table className="w-full text-start border-collapse">
            <tbody>
              {component.specifications.map((row, i) => (
                <tr key={i} className="border-b border-outline-variant last:border-b-0">
                  <th className="px-4 py-2 font-body-md text-body-md text-on-surface-variant font-normal text-start w-1/3">
                    {row.label}
                  </th>
                  <td className="px-4 py-2 font-mono-sm text-mono-sm text-on-surface">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Attachments type="component" id={component.id} canEdit={canUpdate} />

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteButton")}
        danger
        onConfirm={handleDelete}
      />
    </div>

    <RelatedContent type="component" id={component.id} canEdit={canUpdate} />
    </div>
  );
}
