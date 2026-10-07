"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { searchKnowledge } from "@/lib/api/knowledge";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON as ICON_BY_TYPE, relationshipChoicesFor } from "@/lib/knowledgeTypes";

const GENERIC_RELATED = "RELATED";

interface RelationTypeChoicesProps {
  sourceType: RelatableType;
  otherType: RelatableType;
  /** Highlights the currently-set verb when changing an existing link. */
  current?: string;
  onPick: (relationType: string | undefined) => void;
}

/** The verb list for a (sourceType, otherType) pair plus the generic
 * "just related" fallback - shared by the add flow's second step and the
 * "change relationship" modal. */
export function RelationTypeChoices({ sourceType, otherType, current, onPick }: RelationTypeChoicesProps) {
  const t = useTranslations("knowledge.relations");
  const itemClass = (active: boolean) =>
    `w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-start font-body-md text-body-md hover:bg-surface-variant transition-colors ${
      active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
    }`;

  return (
    <ul className="space-y-1">
      {relationshipChoicesFor(sourceType, otherType).map(({ verb }) => (
        <li key={verb}>
          <button type="button" onClick={() => onPick(verb)} className={itemClass(current === verb)}>
            {verb}
            {current === verb && <Icon name="check" size={14} />}
          </button>
        </li>
      ))}
      <li className="border-t border-outline-variant pt-1">
        <button
          type="button"
          onClick={() => onPick(undefined)}
          className={itemClass(current === GENERIC_RELATED)}
        >
          <span className={current === GENERIC_RELATED ? "" : "text-on-surface-variant"}>
            {t("genericRelatedOption")}
          </span>
          {current === GENERIC_RELATED && <Icon name="check" size={14} />}
        </button>
      </li>
    </ul>
  );
}

interface RelationPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: RelatableType;
  /** The item's own id, filtered out of search results - omit for a not-yet-created item. */
  sourceId?: string;
  /** "type:id" keys already linked, also filtered out. */
  excludeKeys?: Set<string>;
  onPick: (result: SearchResult, relationType: string | undefined) => void | Promise<void>;
}

/** Search -> (if the pair has semantic verbs) choose a verb -> onPick. Used
 * both on a saved item's Related Content panel and on creation forms,
 * where the pick is only staged until the item itself is saved. */
export function RelationPickerModal({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  excludeKeys,
  onPick,
}: RelationPickerModalProps) {
  const t = useTranslations("knowledge.relations");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Set once a search result is clicked, if it has semantic relationship
  // choices - the modal shows the verb picker instead of search while set.
  const [pendingResult, setPendingResult] = useState<SearchResult | null>(null);

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

  // Filtered at render time (not in the effect) so a caller passing a fresh
  // excludeKeys Set every render doesn't retrigger the search.
  const visibleResults = results.filter(
    (result) =>
      !(result.type === sourceType && result.id === sourceId) && !excludeKeys?.has(`${result.type}:${result.id}`),
  );

  function close() {
    onOpenChange(false);
    setQuery("");
    setResults([]);
    setPendingResult(null);
  }

  async function pick(result: SearchResult, relationType: string | undefined) {
    await onPick(result, relationType);
    close();
  }

  function handleResultClick(result: SearchResult) {
    if (relationshipChoicesFor(sourceType, result.type).length === 0) {
      void pick(result, undefined);
    } else {
      setPendingResult(result);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
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
          <RelationTypeChoices
            sourceType={sourceType}
            otherType={pendingResult.type}
            onPick={(relationType) => void pick(pendingResult, relationType)}
          />
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
              {(query.trim() ? visibleResults : []).map((result) => (
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
  );
}

interface RelationTypeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: RelatableType;
  otherType: RelatableType;
  otherTitle: string;
  current: string;
  onPick: (relationType: string) => void | Promise<void>;
}

/** "Change relationship" for an existing (or staged) link. */
export function RelationTypeModal({
  open,
  onOpenChange,
  sourceType,
  otherType,
  otherTitle,
  current,
  onPick,
}: RelationTypeModalProps) {
  const t = useTranslations("knowledge.relations");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("changeTypeTitle")}>
      <div className="space-y-3">
        <p className="font-body-md text-body-md text-on-surface-variant">
          {t("chooseRelationTypeDescription", { title: otherTitle })}
        </p>
        <RelationTypeChoices
          sourceType={sourceType}
          otherType={otherType}
          current={current}
          onPick={async (relationType) => {
            await onPick(relationType ?? GENERIC_RELATED);
            onOpenChange(false);
          }}
        />
      </div>
    </Modal>
  );
}
