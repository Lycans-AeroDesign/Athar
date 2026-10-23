"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { DetailPageSkeleton } from "@/components/ui/Skeleton";
import { TagChip } from "@/components/ui/TagChip";
import { UpdatedBadge } from "@/components/ui/UpdatedBadge";
import { Link, useRouter } from "@/i18n/navigation";
import {
  deleteCollection,
  getCollection,
  removeCollectionItem,
  reorderCollectionItems,
} from "@/lib/api/collections";
import type { CollectionContentRef } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/lib/useResource";

/** Item-detail routes by relatable type - mirrors the app's route tree
 * (app/[locale]/(protected)/*). Copied from SeriesStepper.tsx's hrefFor
 * (kept separate: this page may list types the stepper never embeds). */
function hrefFor(ref: CollectionContentRef): string {
  switch (ref.type) {
    case "article":
      return `/knowledge/articles/${ref.id}`;
    case "sop":
      return `/sops/${ref.id}`;
    case "question":
      return `/knowledge/questions/${ref.id}`;
    case "component":
      return `/components/${ref.id}`;
    case "failure":
      return `/failures/${ref.id}`;
    case "test":
      return `/tests/${ref.id}`;
    case "document":
      return `/documents/${ref.id}`;
    case "project":
      return `/projects/${ref.id}`;
    default:
      return "";
  }
}

const TYPE_ICONS: Record<string, string> = {
  article: "article",
  sop: "description",
  question: "forum",
  component: "settings_input_component",
  failure: "report_problem",
  test: "science",
  document: "description",
  project: "flight",
};

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.collections");
  const router = useRouter();
  const canManage = useHasPermission("collection.manage");

  const { data: collection, setData: setCollection, notFound } = useResource(id, getCollection);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Drag-to-reorder (native HTML5 drag & drop, gated on the grip handle):
  // dragReadyId marks the item whose handle is pressed so its <li> becomes
  // draggable (dragging from elsewhere in the row would fight text
  // selection); dragIndex/dropIndex drive the live visual feedback.
  const [dragReadyId, setDragReadyId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!collection) {
    return <DetailPageSkeleton />;
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const ids = collection!.items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + direction, 0, moved);
    setActionError(null);
    setIsWorking(true);
    try {
      setCollection(await reorderCollectionItems(collection!.id, ids));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDragReorder(from: number, to: number) {
    if (from === to) return;
    const ids = collection!.items.map((item) => item.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setActionError(null);
    setIsWorking(true);
    try {
      setCollection(await reorderCollectionItems(collection!.id, ids));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setIsWorking(false);
    }
  }

  function clearDragState() {
    setDragReadyId(null);
    setDragIndex(null);
    setDropIndex(null);
  }

  async function handleRemove(itemId: string) {
    setActionError(null);
    setIsWorking(true);
    try {
      // Optimistic drop (renumbered) - rolled back by refetching on failure.
      setCollection({
        ...collection!,
        items: collection!.items
          .filter((item) => item.id !== itemId)
          .map((item, index) => ({ ...item, order: index })),
      });
      await removeCollectionItem(collection!.id, itemId);
    } catch (err) {
      setActionError(errorMessage(err));
      getCollection(collection!.id).then(setCollection, () => undefined);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteCollection(collection!.id);
      router.push(collection!.content_scope === "ARTICLE" ? "/knowledge" : "/sops");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6 max-w-[800px]">
      <Link
        href={collection.content_scope === "ARTICLE" ? "/knowledge" : "/sops"}
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {collection.content_scope === "ARTICLE" ? t("backToKnowledge") : t("backToSops")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 bg-primary-container text-on-primary-container font-label-caps text-label-caps px-2.5 py-1 rounded-full uppercase">
            <Icon name={collection.mode === "SERIES" ? "format_list_numbered" : "folder_open"} size={14} />
            {collection.mode === "SERIES" ? t("mode.SERIES") : t("mode.FOLDER")}
          </span>
          {canManage && (
            <IconButton
              icon="delete"
              variant="danger"
              aria-label={t("deleteButton")}
              onClick={() => setDeleteOpen(true)}
            />
          )}
        </div>
        <h1 className="font-display text-display text-on-surface">{collection.title}</h1>
        {collection.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {collection.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        <UpdatedBadge updatedAt={collection.updated_at} createdAt={collection.created_at} />
      </div>

      {collection.description && <Markdown content={collection.description} />}

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {collection.items.length === 0 ? (
        <DetailMessage>{collection.mode === "SERIES" ? t("emptySeries") : t("emptyFolder")}</DetailMessage>
      ) : (
        <ol className="space-y-2">
          {collection.items.map((item, index) => {
            const ref = item.content;
            const href = ref ? hrefFor(ref) : "";
            return (
              <li
                key={item.id}
                draggable={canManage && (dragReadyId === item.id || dragIndex === index)}
                onDragStart={(e) => {
                  if (dragReadyId !== item.id) {
                    // Dragging from anywhere other than the handle - ignore.
                    e.preventDefault();
                    return;
                  }
                  setDragIndex(index);
                  setDropIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox only starts a drag when data is set.
                  try {
                    e.dataTransfer.setData("text/plain", item.id);
                  } catch {
                    // No-op: a data-less drag is fine in browsers that don't ask.
                  }
                }}
                onDragEnd={clearDragState}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropIndex !== index) setDropIndex(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) {
                    void handleDragReorder(dragIndex, dropIndex ?? dragIndex);
                  }
                  clearDragState();
                }}
                className={`flex items-center gap-3 rounded-xl p-4 transition-shadow ${
                  dragIndex === index
                    ? "bg-surface-container opacity-40 border border-dashed border-primary"
                    : dropIndex === index && dragIndex !== null && dropIndex !== dragIndex
                      ? "bg-primary-container border-2 border-primary"
                      : "bg-surface-container-low border border-outline-variant"
                }`}
              >
                {canManage && (
                  <button
                    type="button"
                    aria-label={t("item.dragHandle")}
                    title={t("item.dragHandle")}
                    onPointerDown={() => setDragReadyId(item.id)}
                    onPointerUp={() => setDragReadyId(null)}
                    className="shrink-0 p-1 -m-1 cursor-grab text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Icon name="drag_handle" size={18} />
                  </button>
                )}
                <span className="shrink-0 w-8 h-8 flex items-center justify-center bg-surface-container-high text-on-surface-variant rounded-full font-headline-sm font-normal text-headline-sm">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {href ? (
                    <Link
                      href={href}
                      className="font-headline-sm font-normal text-headline-sm text-on-surface hover:text-primary hover:underline transition-colors block truncate"
                    >
                      {item.phase_title || ref!.title}
                    </Link>
                  ) : (
                    <span className="font-headline-sm font-normal text-headline-sm text-on-surface-variant">
                      {t("missingContent")}
                    </span>
                  )}
                  {item.phase_title && ref && ref.title !== item.phase_title && (
                    <span className="block font-label-md text-label-md text-on-surface-variant truncate">{ref.title}</span>
                  )}
                  {item.note && (
                    <span className="block font-label-md text-label-md text-on-surface-variant">{item.note}</span>
                  )}
                </span>
                {ref && <Icon name={TYPE_ICONS[ref.type] ?? "description"} size={16} className="text-on-surface-variant shrink-0" />}
                {canManage && (
                  <>
                    <IconButton
                      icon="arrow_upward"
                      variant="secondary"
                      aria-label={t("item.moveUp")}
                      disabled={isWorking || index === 0}
                      onClick={() => void handleMove(index, -1)}
                    />
                    <IconButton
                      icon="arrow_downward"
                      variant="secondary"
                      aria-label={t("item.moveDown")}
                      disabled={isWorking || index === collection!.items.length - 1}
                      onClick={() => void handleMove(index, 1)}
                    />
                    <IconButton
                      icon="delete"
                      variant="danger"
                      aria-label={t("item.remove")}
                      disabled={isWorking}
                      onClick={() => void handleRemove(item.id)}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

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
  );
}
