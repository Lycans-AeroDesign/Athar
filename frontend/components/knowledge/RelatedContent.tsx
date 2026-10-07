"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { RelationPickerModal, RelationTypeModal } from "@/components/knowledge/RelationPicker";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { createRelation, deleteRelation, getRelations, updateRelation } from "@/lib/api/knowledge";
import type { KnowledgeRelation, RelatableType, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON as ICON_BY_TYPE, RELATABLE_ROUTE_PREFIX as ROUTE_PREFIX } from "@/lib/knowledgeTypes";

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
export const GROUP_ORDER: RelatableType[] = [
  "article",
  "question",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
];

export const GROUP_LABEL_KEYS: Record<RelatableType, string> = {
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
// the right column), grouped by type with a colored accent bar per group.
// Adding goes through RelationPickerModal (search, then a relationship type
// when the pair has any); each link can then have its relationship type
// changed or be removed - both actions always visible (not hover-only) so
// they work on touch screens too.
export function RelatedContent({ type, id, canEdit }: RelatedContentProps) {
  const t = useTranslations("knowledge.relations");
  const [relations, setRelations] = useState<KnowledgeRelation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeRelation | null>(null);
  const [removing, setRemoving] = useState<KnowledgeRelation | null>(null);

  useEffect(() => {
    getRelations(type, id)
      .then(setRelations)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [type, id]);

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
      setRelations((prev) => [...(prev ?? []).filter((r) => r.id !== relation.id), relation]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleChangeType(relation: KnowledgeRelation, relationType: string) {
    setError(null);
    try {
      const updated = await updateRelation(relation.id, { from_type: type, from_id: id, relation_type: relationType });
      setRelations((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
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
                  <li key={relation.id} className="group flex items-start gap-1">
                    <Link
                      href={`${ROUTE_PREFIX[relation.other_type]}/${relation.other_id}`}
                      className="flex min-w-0 flex-1 items-start gap-2 p-2 rounded-lg hover:bg-surface-variant transition-colors"
                    >
                      <Icon
                        name={ICON_BY_TYPE[relation.other_type]}
                        size={16}
                        className="text-on-surface-variant shrink-0 mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-body-md text-body-md text-on-surface truncate group-hover:text-primary transition-colors">
                          {relation.other_title}
                        </span>
                        {/* Only called out when it's more specific than the
                            generic fallback - keeps the common case (plain
                            "Related") from looking noisier than it needs to. */}
                        {relation.relation_label !== "RELATED" && (
                          <span className="block font-label-caps text-label-caps text-on-surface-variant">
                            {relation.relation_label}
                          </span>
                        )}
                      </span>
                    </Link>
                    {canEdit && (
                      <div className="flex shrink-0 items-center pt-1.5 lg:opacity-60 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => setEditing(relation)}
                          aria-label={t("changeTypeButton")}
                          title={t("changeTypeButton")}
                          className="p-1 rounded text-on-surface-variant hover:text-primary transition-colors"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(relation)}
                          aria-label={t("removeButton")}
                          title={t("removeButton")}
                          className="p-1 rounded text-on-surface-variant hover:text-error transition-colors"
                        >
                          <Icon name="delete" size={14} />
                        </button>
                      </div>
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

      <RelationPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sourceType={type}
        sourceId={id}
        excludeKeys={new Set(relations.map((r) => `${r.other_type}:${r.other_id}`))}
        onPick={handleAdd}
      />

      {editing && (
        <RelationTypeModal
          open
          onOpenChange={(open) => !open && setEditing(null)}
          sourceType={type}
          otherType={editing.other_type}
          otherTitle={editing.other_title ?? ""}
          current={editing.relation_label}
          onPick={(relationType) => handleChangeType(editing, relationType)}
        />
      )}

      <ConfirmModal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmDescription", { title: removing?.other_title ?? "" })}
        confirmLabel={t("removeButton")}
        danger
        onConfirm={async () => {
          if (removing) await handleRemove(removing.id);
          setRemoving(null);
        }}
      />
    </aside>
  );
}
