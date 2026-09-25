"use client";

import { useTranslations } from "next-intl";

import { EngineeringStatusPill, StockStatusPill } from "@/components/engineering/ComponentBadges";
import { ComponentPhotoCell } from "@/components/engineering/ComponentPhotoCell";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { ComponentOrdering } from "@/lib/api/engineering";
import type { ComponentSummary } from "@/lib/api/types";
import { CONDITION_ICONS } from "@/lib/optionIcons";

interface ComponentsTableProps {
  components: ComponentSummary[];
  ordering: ComponentOrdering | undefined;
  onOrderingChange: (ordering: ComponentOrdering) => void;
}

// See backend/knowledge/views.py's COMPONENT_ORDERING_FIELDS for the field
// names this must stay in sync with. Photo and tags have no sortable field
// (a FK/M2M with no natural order), so they're plain, non-interactive
// columns. Inventory columns come right after the name - the order the
// workshop inventory sheet puts them in.
export function ComponentsTable({ components, ordering, onOrderingChange }: ComponentsTableProps) {
  const t = useTranslations("engineering.component");
  const conditionT = useTranslations("engineering.componentCondition");
  const inventoryTypeT = useTranslations("engineering.inventoryType");
  const muted = "font-body-md text-body-md text-on-surface-variant";

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
      render: (component) => <span className={muted}>{component.category?.name || t("noValue")}</span>,
    },
    {
      field: "location",
      labelKey: "colLocation",
      cellClassName: "max-w-[220px] truncate",
      render: (component) => <span className={muted}>{component.location?.name || t("noValue")}</span>,
    },
    {
      field: "quantity_available",
      labelKey: "colQuantity",
      render: (component) => (
        <span className={`font-mono-sm text-mono-sm ${component.quantity_available > 0 ? "text-on-surface-variant" : "text-error"}`}>
          {component.quantity_available}
          {component.unit && <span className="ms-1 font-body-md text-body-md">{component.unit}</span>}
        </span>
      ),
    },
    {
      field: "stock_status",
      labelKey: "colStockStatus",
      render: (component) =>
        component.stock_status ? <StockStatusPill status={component.stock_status} /> : <span className={muted}>{t("noValue")}</span>,
    },
    {
      field: "condition",
      labelKey: "colCondition",
      render: (component) =>
        component.condition ? (
          <span className={`inline-flex items-center gap-1 ${muted}`}>
            <Icon
              name={CONDITION_ICONS[component.condition].icon}
              size={14}
              className={CONDITION_ICONS[component.condition].iconClassName}
            />
            {conditionT(component.condition)}
          </span>
        ) : (
          <span className={muted}>{t("noValue")}</span>
        ),
    },
    {
      field: "inventory_type",
      labelKey: "colInventoryType",
      render: (component) => (
        <span className={muted}>{component.inventory_type ? inventoryTypeT(component.inventory_type) : t("noValue")}</span>
      ),
    },
    {
      field: "status",
      labelKey: "colStatus",
      render: (component) =>
        component.status ? <EngineeringStatusPill status={component.status} /> : <span className={muted}>{t("noValue")}</span>,
    },
    {
      field: "manufacturer",
      labelKey: "colManufacturer",
      render: (component) => <span className={muted}>{component.manufacturer || t("noValue")}</span>,
    },
    {
      field: "part_number",
      labelKey: "colPartNumber",
      render: (component) => (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{component.part_number || t("noValue")}</span>
      ),
    },
    {
      field: "visibility",
      labelKey: "colVisibility",
      render: (component) => <span className={muted}>{t(`visibility${component.visibility}`)}</span>,
    },
    {
      labelKey: "colTags",
      cellClassName: "max-w-[220px] truncate",
      render: (component) => (
        <span className={muted}>{component.tags.map((tag) => tag.name).join(", ") || t("noValue")}</span>
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
