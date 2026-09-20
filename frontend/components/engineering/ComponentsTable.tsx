"use client";

import { useTranslations } from "next-intl";

import { ComponentPhotoCell } from "@/components/engineering/ComponentPhotoCell";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { ComponentOrdering } from "@/lib/api/engineering";
import type { ComponentStatus, ComponentSummary } from "@/lib/api/types";

// Mirrors page.tsx's STATUS_CLASSES - kept as its own copy (3 entries) rather
// than a shared import, since page.tsx renders this component and importing
// back from page.tsx would create a circular import for something this small.
const STATUS_CLASSES: Record<ComponentStatus, string> = {
  CERTIFIED: "bg-primary-container text-on-primary-container",
  TESTING: "bg-tertiary-container text-on-tertiary-container",
  DEPRECATED: "bg-error-container text-on-error-container",
};

interface ComponentsTableProps {
  components: ComponentSummary[];
  ordering: ComponentOrdering | undefined;
  onOrderingChange: (ordering: ComponentOrdering) => void;
}

// Column set/formatting matches this table's original hand-rolled markup
// 1:1 - see backend/knowledge/views.py's COMPONENT_ORDERING_FIELDS for the
// field names this must stay in sync with. Photo and tags have no sortable
// field (a FK/M2M with no natural order), so they're plain, non-interactive
// columns.
export function ComponentsTable({ components, ordering, onOrderingChange }: ComponentsTableProps) {
  const t = useTranslations("engineering.component");
  const statusT = useTranslations("engineering.componentStatus");

  const columns: DataTableColumn<ComponentSummary>[] = [
    {
      labelKey: "colPhoto",
      render: (component) =>
        component.photo ? (
          <ComponentPhotoCell photo={component.photo} alt={component.name} />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low">
            <Icon name="image" size={16} className="text-outline" />
          </div>
        ),
    },
    {
      field: "name",
      labelKey: "colName",
      render: (component) => (
        <Link href={`/components/${component.id}`} className="font-body-md text-body-md text-primary hover:underline">
          {component.name}
        </Link>
      ),
    },
    {
      field: "category",
      labelKey: "colCategory",
      render: (component) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{component.category?.name || t("noValue")}</span>
      ),
    },
    {
      field: "manufacturer",
      labelKey: "colManufacturer",
      render: (component) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{component.manufacturer || t("noValue")}</span>
      ),
    },
    {
      field: "part_number",
      labelKey: "colPartNumber",
      render: (component) => (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{component.part_number || t("noValue")}</span>
      ),
    },
    {
      field: "status",
      labelKey: "colStatus",
      render: (component) => (
        <span
          className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[component.status]}`}
        >
          {statusT(component.status)}
        </span>
      ),
    },
    {
      field: "quantity_available",
      labelKey: "colQuantity",
      render: (component) => (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{component.quantity_available}</span>
      ),
    },
    {
      field: "visibility",
      labelKey: "colVisibility",
      render: (component) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{t(`visibility${component.visibility}`)}</span>
      ),
    },
    {
      labelKey: "colTags",
      cellClassName: "max-w-[220px] truncate",
      render: (component) => (
        <span className="font-body-md text-body-md text-on-surface-variant">
          {component.tags.map((tag) => tag.name).join(", ") || t("noValue")}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={components}
      t={t}
      ordering={ordering}
      onOrderingChange={(value) => onOrderingChange(value as ComponentOrdering)}
    />
  );
}
