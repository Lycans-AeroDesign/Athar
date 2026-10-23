"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { CreateCollectionModal } from "@/components/knowledge/CreateCollectionModal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { getCollections } from "@/lib/api/collections";
import type { CollectionSummary } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";

/** The horizontal "Series & collections" strip shown above a content list
 * (SOPs page / Knowledge landing), filtered to the scope of that page -
 * e.g. the SOPs page shows SOP/MIXED collections only, so an article series
 * never appears over the SOP list and vice versa. The "New" button (visible
 * to collection.manage holders) turns this shelf into a creation spot,
 * answering "where do collections get created" without hunting for it. */
export function CollectionShelf({ scope }: { scope: "SOP" | "ARTICLE" }) {
  const t = useTranslations("knowledge.collections");
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCollections({ scope }).then(
      (result) => setCollections(result.results),
      (err) => setError(errorMessage(err)),
    );
  }, [scope]);

  if (error) return null; // The shelf is optional decoration - never block the page it lives on.
  if (collections === null) return <ListSkeleton rows={1} />;

  return (
    <section className="space-y-3" aria-label={t("shelf.title")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
          <Icon name="format_list_numbered" size={18} className="text-primary" />
          {t("shelf.title")}
        </h2>
        <Can permission="collection.manage">
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={16} />
            {t("shelf.newButton")}
          </Button>
        </Can>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {collections.length === 0 ? (
          <li className="font-body-md text-body-md text-on-surface-variant py-2">{t("shelf.empty")}</li>
        ) : (
          collections.map((collection) => (
            <li key={collection.id} className="shrink-0 w-64">
              <Link
                href={`/collections/${collection.id}`}
                className="flex flex-col h-full gap-1 bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
              >
                <span className="flex items-center gap-1.5 font-label-caps text-label-caps uppercase text-primary">
                  <Icon name={collection.mode === "SERIES" ? "format_list_numbered" : "folder_open"} size={14} />
                  {collection.mode === "SERIES" ? t("mode.SERIES") : t("mode.FOLDER")}
                </span>
                <span className="font-headline-sm font-normal text-headline-sm text-on-surface line-clamp-2">
                  {collection.title}
                </span>
                <span className="font-label-md text-label-md text-on-surface-variant mt-auto">
                  {t("shelf.itemCount", { count: collection.item_count })}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
      <CreateCollectionModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultScope={scope}
        onCreated={(collection) => setCollections((existing) => [collection, ...(existing ?? [])])}
      />
    </section>
  );
}
