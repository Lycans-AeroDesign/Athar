"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { RelationPickerModal, RelationTypeModal } from "@/components/knowledge/RelationPicker";
import { Icon } from "@/components/ui/Icon";
import type { CreationRelationInput, RelatableType } from "@/lib/api/types";
import { RELATABLE_ICON as ICON_BY_TYPE } from "@/lib/knowledgeTypes";

/** A related-content link staged on a creation form - sent with the create
 * request (see CreationRelationInput) and saved in the same transaction as
 * the item. `title` is display-only. */
export interface PendingRelation extends CreationRelationInput {
  title: string;
}

/** The create payload's `relations` list, minus the display-only titles. */
export function toRelationInputs(pending: PendingRelation[]): CreationRelationInput[] {
  return pending.map(({ target_type, target_id, relation_type }) => ({ target_type, target_id, relation_type }));
}

interface PendingRelationsProps {
  sourceType: RelatableType;
  value: PendingRelation[];
  onChange: (value: PendingRelation[]) => void;
}

// Creation-form counterpart of RelatedContent: same picker, but links are
// only staged locally (the item has no id yet) and each can be retyped or
// dropped before saving.
export function PendingRelations({ sourceType, value, onChange }: PendingRelationsProps) {
  const t = useTranslations("knowledge.relations");
  const creationT = useTranslations("creation");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editing = editingIndex === null ? null : value[editingIndex];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase">
          <Icon name="hub" size={14} />
          {t("title")}
        </label>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary hover:opacity-80 transition-opacity"
        >
          <Icon name="add" size={14} />
          {t("addButton")}
        </button>
      </div>

      {value.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{creationT("relatedEmpty")}</p>
      ) : (
        <ul className="space-y-1">
          {value.map((relation, index) => (
            <li
              key={`${relation.target_type}:${relation.target_id}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container border border-outline-variant"
            >
              <Icon name={ICON_BY_TYPE[relation.target_type]} size={16} className="text-on-surface-variant shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-body-md text-body-md text-on-surface truncate">{relation.title}</span>
                {relation.relation_type && relation.relation_type !== "RELATED" && (
                  <span className="block font-label-caps text-label-caps text-on-surface-variant">
                    {relation.relation_type}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setEditingIndex(index)}
                aria-label={t("changeTypeButton")}
                title={t("changeTypeButton")}
                className="p-1 rounded text-on-surface-variant hover:text-primary transition-colors"
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={t("removeButton")}
                title={t("removeButton")}
                className="p-1 rounded text-on-surface-variant hover:text-error transition-colors"
              >
                <Icon name="delete" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <RelationPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sourceType={sourceType}
        excludeKeys={new Set(value.map((r) => `${r.target_type}:${r.target_id}`))}
        onPick={(result, relationType) =>
          onChange([
            ...value,
            { target_type: result.type, target_id: result.id, title: result.title, relation_type: relationType },
          ])
        }
      />

      {editing && editingIndex !== null && (
        <RelationTypeModal
          open
          onOpenChange={(open) => !open && setEditingIndex(null)}
          sourceType={sourceType}
          otherType={editing.target_type}
          otherTitle={editing.title}
          current={editing.relation_type ?? "RELATED"}
          onPick={(relationType) =>
            onChange(
              value.map((r, i) =>
                i === editingIndex ? { ...r, relation_type: relationType === "RELATED" ? undefined : relationType } : r,
              ),
            )
          }
        />
      )}
    </div>
  );
}
