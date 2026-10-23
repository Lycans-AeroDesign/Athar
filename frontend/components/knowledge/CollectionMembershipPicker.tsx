"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { CreateCollectionModal } from "@/components/knowledge/CreateCollectionModal";
import { Icon } from "@/components/ui/Icon";
import { getCollectionsIncludingMixed } from "@/lib/api/collections";
import type { CollectionSummary } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";

/** Editor widget listing the SOP-adjacent (or article-adjacent) collections
 * with toggle-in/toggle-out checkboxes, plus an inline create option (see
 * CreateCollectionModal): someone organizing a series can mint it right
 * there instead of hunting for where collections live. The whole widget is
 * only rendered for collection.manage holders - adding content to a
 * collection is a manage action backend-side, so showing it to anyone else
 * would just save 403s.
 *
 * The save handler turns the selection into a diff against the item's
 * original memberships (collections.ts syncCollectionMembership). */
export function CollectionMembershipPicker({
  itemType,
  selectedIds,
  onChange,
}: {
  itemType: string;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}) {
  const t = useTranslations("knowledge.collections");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getCollectionsIncludingMixed(itemType === "sop" ? "SOP" : "ARTICLE").then(
      (result) => setCollections(result.sort((a, b) => a.title.localeCompare(b.title))),
      (err) => setLoadError(errorMessage(err)),
    );
  }, [itemType]);

  function toggle(collectionId: string) {
    onChange(
      selectedIds.includes(collectionId)
        ? selectedIds.filter((id) => id !== collectionId)
        : [...selectedIds, collectionId],
    );
  }

  if (loadError) {
    return <p className="font-body-md text-body-md text-error">{loadError}</p>;
  }
  if (collections.length === 0 && !loadError) {
    return (
      <>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 border border-dashed border-primary text-primary rounded-full px-3 py-1.5 font-label-md text-label-md hover:bg-primary-container transition-colors"
        >
          <Icon name="add" size={14} />
          {t("picker.createNew")}
        </button>
        <p className="font-label-md text-label-md text-on-surface-variant">{t("picker.browseNote")}</p>
        <CreateCollectionModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultScope={itemType === "sop" ? "SOP" : "ARTICLE"}
          onCreated={(collection) => {
            setCollections((existing) => [...existing, collection].sort((a, b) => a.title.localeCompare(b.title)));
            onChange([...selectedIds, collection.id]);
          }}
        />
      </>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {collections.map((collection) => {
        const selected = selectedIds.includes(collection.id);
        return (
          <button
            key={collection.id}
            type="button"
            onClick={() => toggle(collection.id)}
            aria-pressed={selected}
            className={`inline-flex items-center gap-1.5 border rounded-full px-3 py-1.5 font-label-md text-label-md transition-colors ${
              selected
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container text-on-surface-variant border-outline-variant hover:border-primary hover:text-on-surface"
            }`}
          >
            <Icon name={selected ? "check_circle" : collection.mode === "SERIES" ? "format_list_numbered" : "folder_open"} size={14} />
            <span className="max-w-[240px] truncate">{collection.title}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="inline-flex items-center gap-1.5 border border-dashed border-primary text-primary rounded-full px-3 py-1.5 font-label-md text-label-md hover:bg-primary-container transition-colors"
      >
        <Icon name="add" size={14} />
        {t("picker.createNew")}
      </button>
      <CreateCollectionModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultScope={itemType === "sop" ? "SOP" : "ARTICLE"}
        onCreated={(collection) => {
          setCollections((existing) => [...existing, collection].sort((a, b) => a.title.localeCompare(b.title)));
          onChange([...selectedIds, collection.id]);
        }}
      />
    </div>
  );
}
