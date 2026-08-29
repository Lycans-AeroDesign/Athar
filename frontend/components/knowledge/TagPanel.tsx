import { useTranslations } from "next-intl";

import type { Tag } from "@/lib/api/types";

interface TagPanelProps {
  tags: Tag[];
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
}

export function TagPanel({ tags, selectedTagId, onSelect }: TagPanelProps) {
  const t = useTranslations("knowledge.landing");

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant p-4 space-y-2 flex-1">
      <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase px-2 pb-1">
        {t("tagsTitle")}
      </h3>
      <div className="flex flex-wrap gap-2 px-2">
        {tags.map((tag) => {
          const isSelected = tag.id === selectedTagId;
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className={`font-mono-sm text-mono-sm rounded-full px-3 py-1 border transition-colors ${
                isSelected
                  ? "border-primary text-primary bg-primary/5"
                  : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
              }`}
            >
              #{tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
