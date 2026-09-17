import type { ReactNode } from "react";

interface ChangedIndicatorProps {
  changed: boolean;
  className?: string;
  children: ReactNode;
  /** Corner the dot sits in - "top-end" (default) unless the wrapped content
   * already has its own control in that corner (e.g. PhotoDropzone's remove
   * button), in which case "bottom-end" avoids the two overlapping. */
  dotPosition?: "top-end" | "bottom-end";
}

const DOT_POSITION_CLASSES: Record<NonNullable<ChangedIndicatorProps["dotPosition"]>, string> = {
  "top-end": "-top-1 -end-1",
  "bottom-end": "-bottom-1 -end-1",
};

// Marks a field as touched since the last save with a small corner dot, in
// the brand accent color (primary) - the same color used for focus rings,
// links, and buttons throughout. Wraps arbitrary children so it works on a
// plain <input> as well as Combobox/TagInput/MarkdownEditor without any of
// those needing their own dirty-visual prop.
export function ChangedIndicator({ changed, className, children, dotPosition = "top-end" }: ChangedIndicatorProps) {
  return (
    <div className={`relative ${className ?? ""}`}>
      {children}
      {changed && (
        <span
          aria-hidden="true"
          className={`absolute ${DOT_POSITION_CLASSES[dotPosition]} h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface pointer-events-none`}
        />
      )}
    </div>
  );
}
