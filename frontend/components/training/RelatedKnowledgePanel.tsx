"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { searchKnowledge } from "@/lib/api/knowledge";
import { createKnowledgeReference, deleteKnowledgeReference, listKnowledgeReferences } from "@/lib/api/training";
import type { LessonKnowledgeReferenceEntry, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

interface RelatedKnowledgePanelProps {
  lessonId: string;
  /** Whether the viewer may add/remove references here (course author or training.update). */
  canEdit: boolean;
}

// Modeled directly on components/knowledge/RelatedContent.tsx's
// searchKnowledge()-backed picker, but writes to LessonKnowledgeReference
// endpoints instead of KnowledgeRelation ones, and has no relation-verb
// picker step - a lesson->Knowledge reference is one-directional and needs
// no verb (see backend/training/models.py's LessonKnowledgeReference docstring).
export function RelatedKnowledgePanel({ lessonId, canEdit }: RelatedKnowledgePanelProps) {
  const t = useTranslations("training.relatedKnowledge");
  const [references, setReferences] = useState<LessonKnowledgeReferenceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    listKnowledgeReferences(lessonId).then(setReferences, (err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [lessonId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const handle = setTimeout(() => {
      setIsSearching(true);
      searchKnowledge(trimmed)
        .then((data) => setResults(data.results))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function closePicker() {
    setPickerOpen(false);
    setQuery("");
    setResults([]);
  }

  async function handleAdd(result: SearchResult) {
    setError(null);
    try {
      const reference = await createKnowledgeReference(lessonId, { content_type: result.type, object_id: result.id });
      setReferences((prev) => [...(prev ?? []), reference]);
      closePicker();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    try {
      await deleteKnowledgeReference(id);
      setReferences((prev) => (prev ?? []).filter((reference) => reference.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!references) return null;
  if (references.length === 0 && !canEdit) return null;

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl">
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
      <div className="p-4 space-y-2">
        {references.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <ul className="space-y-0.5">
            {references.map((reference) => (
              <li key={reference.id} className="group relative">
                <Link
                  href={`${RELATABLE_ROUTE_PREFIX[reference.content_type_name]}/${reference.object_id}`}
                  className="flex items-start gap-2 p-2 rounded-lg hover:bg-surface-variant transition-colors"
                >
                  <Icon
                    name={RELATABLE_ICON[reference.content_type_name]}
                    size={16}
                    className="text-on-surface-variant shrink-0 mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-body-md text-body-md text-on-surface truncate group-hover:text-primary transition-colors">
                      {reference.title}
                    </span>
                    {reference.note && (
                      <span className="block font-label-caps text-label-caps text-on-surface-variant">
                        {reference.note}
                      </span>
                    )}
                  </span>
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemove(reference.id)}
                    aria-label={t("removeButton")}
                    className="absolute top-2 end-2 text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
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
      </div>

      <Modal
        open={pickerOpen}
        onOpenChange={(open) => (open ? setPickerOpen(true) : closePicker())}
        title={t("addButton")}
      >
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
                    <Icon name={RELATABLE_ICON[result.type]} size={16} className="text-on-surface-variant shrink-0" />
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
