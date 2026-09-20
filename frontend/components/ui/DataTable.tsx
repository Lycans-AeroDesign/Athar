"use client";

import type { ReactNode } from "react";

import { Icon } from "./Icon";

export interface DataTableColumn<T> {
  /** Backend ordering field name (see e.g. backend/knowledge/views.py's
   * COMPONENT_ORDERING_FIELDS) - omit for a column with no natural sort (a
   * M2M like tags, a computed/media cell, etc), which renders as a plain,
   * non-interactive header instead of a sort button. */
  field?: string;
  labelKey: string;
  render: (row: T) => ReactNode;
  /** Extra classes for this column's <td> (e.g. a max-width + truncate for
   * a tags cell that could otherwise run very long). */
  cellClassName?: string;
}

interface DataTableProps<T extends { id: string }> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Scoped to the caller's own i18n namespace, so each column's labelKey
   * resolves against that entity's own messages rather than a shared set -
   * every table (Components, Failures, Tests, Documents, ...) keeps its own
   * column label strings instead of a forced-shared vocabulary. */
  t: (key: string) => string;
  ordering: string | undefined;
  onOrderingChange: (ordering: string) => void;
}

// Generic sortable-table shell - column definitions (what a cell renders,
// whether it's sortable) come entirely from the caller; this only owns the
// <table> markup and the sortable-header button's click/hover/arrow-
// indicator behavior. See ComponentsTable.tsx (photo-with-hover-preview,
// tags, a component-specific status enum), and the equivalent Failures/
// Tests/Documents table components, for how differently-shaped entities
// each plug their own column set into this same shell.
export function DataTable<T extends { id: string }>({ columns, rows, t, ordering, onOrderingChange }: DataTableProps<T>) {
  function toggleOrdering(field: string): string {
    // First click on a column sorts ascending; clicking the already-active
    // column flips direction. Clicking a different column always starts
    // ascending again, rather than remembering each column's last direction.
    return ordering === field ? `-${field}` : field;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant">
      <table className="w-full text-start border-collapse">
        <thead>
          <tr className="border-b border-outline-variant bg-surface-container-low">
            {columns.map((column, index) => {
              if (!column.field) {
                return (
                  <th key={index} scope="col" className="px-4 py-3 text-start whitespace-nowrap">
                    <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                      {t(column.labelKey)}
                    </span>
                  </th>
                );
              }
              const field = column.field;
              const isDescending = ordering === `-${field}`;
              const isActive = ordering === field || isDescending;
              return (
                <th key={field} scope="col" className="p-0 text-start whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onOrderingChange(toggleOrdering(field))}
                    className="group inline-flex w-full items-center gap-1 px-4 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase transition-colors duration-150 hover:bg-surface-container-high hover:text-on-surface cursor-pointer"
                  >
                    {t(column.labelKey)}
                    <Icon
                      name={isDescending ? "arrow_downward" : "arrow_upward"}
                      size={14}
                      className={`transition-opacity duration-150 ${
                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"
                      }`}
                    />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
              {columns.map((column, index) => (
                <td key={column.field ?? index} className={`px-4 py-3 ${column.cellClassName ?? ""}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
