"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useState, type InputHTMLAttributes } from "react";

import { Icon } from "./Icon";

interface FloatingLabelInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: string;
  /** Renders under the field in the app's own style, instead of relying on
   * the browser's native validation bubble (see `noValidate` on the forms
   * that use this) - pass the caller's own validation message here. */
  error?: string;
}

// Text input whose label sits inside the field (like a placeholder) and
// floats to the top-left on focus or once filled - driven entirely by CSS
// (:placeholder-shown / :focus via Tailwind's peer variants), so it works
// correctly with browser autofill too, not just React-tracked focus state.
// type="password" automatically gets a show/hide toggle.
export const FloatingLabelInput = forwardRef<HTMLInputElement, FloatingLabelInputProps>(
  function FloatingLabelInput({ label, icon, error, id, className, type, ...props }, ref) {
    const t = useTranslations("auth");
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const leftInset = icon ? "left-10" : "left-4";

    return (
      <div>
        {/* icon/label/password-toggle all position themselves via inset-0/top-1/2
            against THIS div specifically - it must contain only the input (a
            normal-flow child sets the div's height), or the error message below
            would stretch it and throw every absolute child's centering off. */}
        <div className="relative">
          {icon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant peer-focus:text-primary">
              <Icon name={icon} size={18} />
            </div>
          )}
          <input
            ref={ref}
            id={id}
            placeholder=" "
            type={isPassword && showPassword ? "text" : type}
            aria-invalid={!!error}
            className={`peer block w-full ${icon ? "pl-10" : "pl-4"} ${isPassword ? "pr-10" : "pr-4"} pt-7 pb-3 font-mono-sm text-mono-sm text-on-surface bg-surface-container border rounded-lg focus:ring-1 outline-none transition-colors ${error ? "border-error focus:border-error focus:ring-error" : "border-outline-variant focus:border-primary focus:ring-primary"} ${className ?? ""}`}
            {...props}
          />
          <label
            htmlFor={id}
            className={`absolute ${leftInset} top-1/2 -translate-y-1/2 font-body-md text-body-md text-on-surface-variant pointer-events-none transition-all duration-150 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:font-label-caps peer-focus:text-label-caps peer-focus:uppercase peer-focus:text-primary peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:translate-y-0 peer-not-placeholder-shown:font-label-caps peer-not-placeholder-shown:text-label-caps peer-not-placeholder-shown:uppercase`}
          >
            {label}
          </label>
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-on-surface-variant hover:text-primary transition-colors"
              aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
            </button>
          )}
        </div>
        {/* Always rendered (space reserved via min-h, hidden via `invisible`
            rather than unmounted) so a field failing/passing validation
            doesn't reflow every field below it. No margin-top: text-body-md's
            own 20px line-height (see globals.css) is already the full
            reserved height - callers space fields via a tight space-y-1
            wrapper, since this slot supplies the rest of that gap. */}
        <p
          className={`min-h-[1.25rem] font-body-md text-body-md text-error ${error ? "" : "invisible"}`}
          role={error ? "alert" : undefined}
        >
          {error || " "}
        </p>
      </div>
    );
  },
);
