"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { createRelation, deleteRelation, getRelations, searchKnowledge } from "@/lib/api/knowledge";
import type { KnowledgeRelation, RelatableType, SearchResult } from "@/lib/api/types";
import {
  RELATABLE_ICON as ICON_BY_TYPE,
  RELATABLE_ROUTE_PREFIX as ROUTE_PREFIX,
  relationshipChoicesFor,
} from "@/lib/knowledgeTypes";

interface RelatedContentProps {
  type: RelatableType;
  id: string;
  /** Whether the viewer may add/remove relations here (same edit rights as the owning item itself). */
  canEdit: boolean;
}

// Fixed display order for the grouped-by-type sections below (docs/VISION.md
// #26's example: "Projects / Components / Tests / Failures / Articles /
// SOPs / Documents" as labeled sub-sections rather than one flat chip row) -
// same order CONTENT_TYPES uses everywhere else (search page, GlobalSearch).
const GROUP_ORDER: RelatableType[] = [
  "article",
  "question",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
];

const GROUP_LABEL_KEYS: Record<RelatableType, string> = {
  article: "groupArticles",
  question: "groupQuestions",
  project: "groupProjects",
  component: "groupComponents",
  failure: "groupFailures",
  sop: "groupSops",
  test: "groupTests",
  document: "groupDocuments",
};

// "This article is related to that question" (and now also Project/
// Component/Failure/Sop/Test/Document) - a light, self-contained cross-link
// between Knowledge content. Rendered as a sticky sidebar panel (see the
// caller's own layout - a `grid-cols-[1fr_320px]`-shaped page with this as
// the right column), matching the "Related Knowledge" panel in
// ref/athar_pixhawk_6x_component - grouped by type with a colored accent bar
// per group rather than the earlier flat/inline chip row. The picker reuses
// searchKnowledge() as-is, which already searches every relatable type.
// Picking a result that has one or more semantic relationship types
// available (relationshipChoicesFor) opens a second step to choose one;
// picking a result with none just creates a plain generic "RELATED" link
// immediately, same as before that existed.
export function RelatedContent({ type, id, canEdit }: RelatedContentProps) {
  const t = useTranslations("knowledge.relations");
  const [relations, setRelations] = useState<KnowledgeRelation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Set once a search result is clicked, if it has semantic relationship
  // choices - the modal shows the verb picker instead of search while this
  // is set, and clears back to null on close or "back".
  const [pendingResult, setPendingResult] = useState<SearchResult | null>(null);

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

  function closePicker() {
    setPickerOpen(false);
    setQuery("");
    setResults([]);
    setPendingResult(null);
  }

  async function handleAdd(result: SearchResult, relationType?: string) {
    setError(null);
    try {
      const relation = await createRelation({
        source_type: type,
        source_id: id,
        target_type: result.type,
        target_id: result.id,
        relation_type: relationType,
      });
      setRelations((prev) => [...(prev ?? []), relation]);
      closePicker();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleResultClick(result: SearchResult) {
    const choices = relationshipChoicesFor(type, result.type);
    if (choices.length === 0) {
      void handleAdd(result);
    } else {
      setPendingResult(result);
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

  const groupedRelations = GROUP_ORDER.map((groupType) => ({
    type: groupType,
    relations: relations.filter((relation) => relation.other_type === groupType),
  })).filter((group) => group.relations.length > 0);

  return (
    <aside className="w-full lg:w-80 shrink-0 bg-surface-container-low border border-outline-variant rounded-xl lg:sticky lg:top-6 self-start">
      <div className="flex items-center justify-between gap-2 p-4 border-b border-outline-variant bg-surface-container-high rounded-t-xl">
        <h3 className="font-label-caps text-label-caps text-on-surface uppercase tracking-wide flex items-center gap-2">
          <Icon name="hub" size={16} />
          {t("title")}
        </h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={t("addButton")}
            className="text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="add" size={18} />
          </button>
        )}
      </div>

      <div className="flex flex-col p-4 gap-5">
        {relations.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          groupedRelations.map((group) => (
            <div key={group.type}>
              <h4 className="font-label-caps text-label-caps text-on-surface-variant mb-2 flex items-center gap-2">
                <span className="w-1 h-3 bg-primary rounded-full shrink-0" />
                {t(GROUP_LABEL_KEYS[group.type])}
              </h4>
              <ul className="flex flex-col gap-0.5">
                {group.relations.map((relation) => (
                  <li key={relation.id} className="group relative">
                    <Link
                      href={`${ROUTE_PREFIX[relation.other_type]}/${relation.other_id}`}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-surface-variant transition-colors"
                    >
                      <Icon name={ICON_BY_TYPE[relation.other_type]} size={16} className="text-on-surface-variant shrink-0 mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-body-md text-body-md text-on-surface truncate group-hover:text-primary transition-colors">
                          {relation.other_title}
                        </span>
                        {/* Only called out when it's more specific than the
                            generic fallback - keeps the common case (plain
                            "Related") from looking noisier than it did
                            before relation_label existed. */}
                        {relation.relation_label !== "RELATED" && (
                          <span className="block font-label-caps text-label-caps text-on-surface-variant">
                            {relation.relation_label}
                          </span>
                        )}
                      </span>
                    </Link>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleRemove(relation.id)}
                        aria-label={t("removeButton")}
                        className="absolute top-2 end-2 text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <Modal
        open={pickerOpen}
        onOpenChange={(open) => (open ? setPickerOpen(true) : closePicker())}
        title={pendingResult ? t("chooseRelationTypeTitle") : t("addButton")}
      >
        {pendingResult ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setPendingResult(null)}
              className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Icon name="arrow_back" size={14} />
              {t("backToSearch")}
            </button>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {t("chooseRelationTypeDescription", { title: pendingResult.title })}
            </p>
            <ul className="space-y-1">
              {relationshipChoicesFor(type, pendingResult.type).map(({ verb }) => (
                <li key={verb}>
                  <button
                    type="button"
                    onClick={() => handleAdd(pendingResult, verb)}
                    className="w-full px-3 py-2 rounded-lg text-start font-body-md text-body-md text-on-surface hover:bg-surface-variant transition-colors"
                  >
                    {verb}
                  </button>
                </li>
              ))}
              <li className="border-t border-outline-variant pt-1">
                <button
                  type="button"
                  onClick={() => handleAdd(pendingResult)}
                  className="w-full px-3 py-2 rounded-lg text-start font-body-md text-body-md text-on-surface-variant hover:bg-surface-variant transition-colors"
                >
                  {t("genericRelatedOption")}
                </button>
              </li>
            </ul>
          </div>
        ) : (
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
                      onClick={() => handleResultClick(result)}
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
        )}
      </Modal>
    </aside>
  );
}
