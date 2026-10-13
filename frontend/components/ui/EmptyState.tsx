import type { ReactNode } from "react";

import { Icon } from "./Icon";

interface EmptyStateProps {
  /** The section's own icon (same one its SideNav entry uses), so the empty
   * box reads as "this section" at a glance. */
  icon: string;
  message: string;
  /** The section's create action (usually its header "New ..." button,
   * wrapped in the same `<Can>` gate) - repeated here so an empty list
   * points at the next step instead of dead-ending. Omit for lists with
   * nothing to create (e.g. an audit log). */
  action?: ReactNode;
}

// Centered "nothing here yet" panel for a list that has no rows - replaces
// the bare one-line <p> each list page used to render on its own.
export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center py-12 px-6 border border-dashed border-outline-variant rounded-xl bg-surface-container-low">
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-surface-container text-on-surface-variant">
        <Icon name={icon} size={24} />
      </div>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-md">{message}</p>
      {action}
    </div>
  );
}
