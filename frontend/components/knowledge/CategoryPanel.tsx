import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import type { Category } from "@/lib/api/types";

interface CategoryPanelProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}

export function CategoryPanel({ categories, selectedCategoryId, onSelect }: CategoryPanelProps) {
  const t = useTranslations("knowledge.landing");

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant p-4 space-y-1">
      <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase px-2 pb-2">
        {t("categoriesTitle")}
      </h3>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id === selectedCategoryId ? null : category.id)}
          className={`flex items-center justify-between w-full px-2 py-2 rounded-lg font-body-md text-body-md text-left transition-colors ${
            category.id === selectedCategoryId
              ? "bg-secondary-container text-on-secondary-container"
              : "text-on-surface hover:bg-surface-variant"
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Icon name="folder" size={18} />
            {category.name}
          </span>
          <span className="shrink-0 ml-2 font-mono-sm text-mono-sm text-on-surface-variant border border-outline-variant rounded-full px-2 py-0.5">
            {category.article_count}
          </span>
        </button>
      ))}
    </div>
  );
}
