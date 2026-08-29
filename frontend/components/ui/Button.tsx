import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary-container text-on-primary hover:bg-on-primary-fixed-variant focus:ring-primary",
  secondary:
    "bg-surface text-on-surface border border-outline-variant hover:bg-surface-variant focus:ring-primary",
  danger: "bg-error text-on-error hover:opacity-90 focus:ring-error",
  ghost: "text-on-surface-variant hover:bg-surface-variant focus:ring-primary",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1 py-2 px-4 rounded-lg font-label-caps text-label-caps uppercase transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
      {...props}
    />
  );
});
