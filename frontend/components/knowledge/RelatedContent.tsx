"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { createRelation, deleteRelation, getRelations, searchKnowledge } from "@/lib/api/knowledge";
import type { KnowledgeRelation, RelatableType, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON as ICON_BY_TYPE, RELATABLE_ROUTE_PREFIX as ROUTE_PREFIX } from "@/lib/knowledgeTypes";

interface RelatedContentProps {
  type: RelatableType;
  id: string;
  /** Whether the viewer may add/remove relations here (same edit rights as the owning item itself). */
  canEdit: boolean;
}

// "This article is related to that question" (and now also Project/
// Component/Failure/Sop) - a light, self-contained cross-link between
// Knowledge content. The picker reuses searchKnowledge() as-is, which
// already searches every relatable type.
export function RelatedContent({ type, id, canEdit }: RelatedContentProps) {
  const t = useTranslations("knowledge.relations");
  const [relations, setRelations] = useState<KnowledgeRelation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    getRelations(type, id)
      .then(setRelations)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [type, id]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const handle = setTimeout(() => {
      setIsSearching(true);
      searchKnowledge(trimmed)
        .then((data) => setResults(data.results.filter((result) => !(result.type === type && result.id === id))))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, type, id]);

  async function handleAdd(result: SearchResult) {
    setError(null);
    try {
      const relation = await createRelation({
        source_type: type,
        source_id: id,
        target_type: result.type,
        target_id: result.id,
      });
      setRelations((prev) => [...(prev ?? []), relation]);
      setPickerOpen(false);
      setQuery("");
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(relationId: string) {
    setError(null);
    try {
      await deleteRelation(relationId);
      setRelations((prev) => (prev ?? []).filter((relation) => relation.id !== relationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!relations) return null;
  if (relations.length === 0 && !canEdit) return null;

  return (
    <div className="pt-6 border-t border-outline-variant space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h3>
        {canEdit && (
          <Button variant="ghost" onClick={() => setPickerOpen(true)}>
            <Icon name="add" size={16} />
            {t("addButton")}
          </Button>
        )}
      </div>

      {relations.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {relations.map((relation) => (
            <li
              key={relation.id}
              className="inline-flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded-full ps-1 pe-2.5 py-1"
            >
              <Link
                href={`${ROUTE_PREFIX[relation.other_type]}/${relation.other_id}`}
                className="flex items-center gap-1.5 font-body-md text-body-md text-on-surface hover:text-primary transition-colors"
              >
                <Icon name={ICON_BY_TYPE[relation.other_type]} size={14} />
                {relation.other_title}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleRemove(relation.id)}
                  aria-label={t("removeButton")}
                  className="text-on-surface-variant hover:text-error transition-colors"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <Modal open={pickerOpen} onOpenChange={setPickerOpen} title={t("addButton")}>
        <div className="space-y-3">
          <input
            className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {isSearching ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("searching")}</p>
          ) : (
            <ul className="space-y-1 max-h-[300px] overflow-y-auto">
              {(query.trim() ? results : []).map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    type="button"
                    onClick={() => handleAdd(result)}
                    className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-start hover:bg-surface-variant transition-colors"
                  >
                    <Icon name={ICON_BY_TYPE[result.type]} size={16} className="text-on-surface-variant shrink-0" />
                    <span className="font-body-md text-body-md text-on-surface truncate">{result.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
