import { forwardRef, type ButtonHTMLAttributes } from "react";

import { Icon } from "./Icon";

type Variant = "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  secondary: "bg-surface text-on-surface border border-outline-variant hover:bg-surface-variant focus:ring-primary",
  danger: "text-error hover:bg-error-container focus:ring-error",
  ghost: "text-on-surface-variant hover:bg-surface-variant hover:text-on-surface focus:ring-primary",
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  variant?: Variant;
  size?: number;
  "aria-label": string;
}

// A compact, square counterpart to Button - for toolbars where a labeled
// button would take too much space (e.g. the article/question detail page's
// edit/archive/delete row next to ShareButton). aria-label is required since
// there's no visible text; it also fills the native `title` tooltip (shown
// on hover) unless a caller passes its own `title` - same pairing
// MarkdownEditor.tsx's toolbar buttons already use, just centralized here so
// every icon-only button gets a hover label for free.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = "ghost", size = 18, className, title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={title ?? props["aria-label"]}
      className={`inline-flex items-center justify-center p-2 rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});
