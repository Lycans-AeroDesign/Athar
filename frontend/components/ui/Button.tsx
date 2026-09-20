import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover focus:ring-primary",
  secondary:
    "bg-surface text-on-surface border border-outline-variant hover:bg-surface-variant focus:ring-primary",
  danger: "bg-error text-on-error hover:opacity-90 focus:ring-error",
  ghost: "text-on-surface-variant hover:bg-surface-variant focus:ring-primary",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** false swaps the always-on click/keyboard focus ring for a
   * keyboard-only one (focus-visible) - for a compact control like an
   * icon-only view toggle where the active state already reads visually
   * through its background color, so a ring on every mouse click is just
   * noise. Keyboard users still get a ring. Defaults to true (the
   * accessible-by-default behavior every other Button keeps). */
  focusRing?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", focusRing = true, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1 py-2 px-4 rounded-lg font-label-caps text-label-caps uppercase transition-colors duration-150 focus:outline-none ${
        focusRing ? "focus:ring-2 focus:ring-offset-2" : "focus-visible:ring-2 focus-visible:ring-offset-2"
      } disabled:opacity-60 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
      {...props}
    />
  );
});
